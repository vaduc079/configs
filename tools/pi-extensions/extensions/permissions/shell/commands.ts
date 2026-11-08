// Turns a bash command string into the ShellParse that classify.ts needs.
// Directory handling follows OpenCode's packages/core/src/shell/parse.ts (a plain `cd` with static operands
// becomes a directory only; wrapped, dynamic or operand-less forms also stay in `commands`).
import type { ShellParse } from "../types.ts"
import { scan } from "./scan.ts"

const CWD = new Set(["cd", "chdir", "popd", "pushd"])

export function parseShell(command: string): ShellParse {
  try {
    const scanned = scan(command, "bash")
    if (scanned.kind === "opaque") return opaque(command)

    const commands: string[] = []
    const directories: string[] = []
    const pathWords: string[] = []
    const readPathWords: string[] = []
    // The scanner leaves redirect targets out of words, so read them from the command text.
    const targets = scanned.commands.map((item) => redirectTargets(item.resource))
    // Per line, not per command: `ls P | xargs rm`, `rm $(realpath P)` and `cat x > "$(realpath P)"` let a
    // read-only command's output pick the file a writer changes. `cd` changes no file; a substitution in its
    // operand is its own item.
    const readOnly =
      !targets.flat().some((target) => target.write && /[$`]/.test(target.text)) &&
      scanned.commands.every((item) => cdOperands(item.rawWords, item.words) !== undefined || isReadOnly(item))
    for (const [index, item] of scanned.commands.entries()) {
      for (const target of targets[index]) {
        if (!/\s/.test(target.text)) (target.write || !readOnly ? pathWords : readPathWords).push(target.text)
      }
      // Declarations are skipped as commands, as in OpenCode; nested substitutions arrive as their own items.
      if (item.declaration) continue

      const cd = cdOperands(item.rawWords, item.words)
      // `cd <dir>` reads and edits nothing; its target is already in `directories`.
      if (!cd) {
        const into = readOnly ? readPathWords : pathWords
        for (const word of item.words.slice(1)) {
          const value = pathWord(word)
          if (value) into.push(value)
        }
      }
      if (cd) directories.push(...cd.directories)
      // Unquoted words joined by single spaces: assignment prefixes and extra blanks cannot hide a command.
      if (!cd?.complete) commands.push(item.words.join(" "))
    }
    return { commands, directories, pathWords: [...new Set(pathWords)], readPathWords: [...new Set(readPathWords)] }
  } catch {
    return opaque(command)
  }
}

function opaque(command: string): ShellParse {
  return { commands: [command.trim()], directories: [], pathWords: [], readPathWords: [] }
}

/**
 * Commands that never change a file named in their arguments, each with a test for the options that
 * would let them write or run another program. Wrappers (`env`, `xargs`, `command`, `sudo`) are not listed,
 * so a wrapped command keeps the edit check. This guards against mistakes, not against deliberate bypasses
 * such as a PATH change or an option built by expansion.
 */
const READ_ONLY: Record<string, (option: string) => boolean> = {
  cat: () => false,
  head: () => false,
  tail: () => false,
  wc: () => false,
  ls: () => false,
  stat: () => false,
  du: () => false,
  readlink: () => false,
  realpath: () => false,
  diff: () => false,
  jq: () => false,
  grep: () => false,
  rg: (o) => /^--(pre|hostname-bin)(=|$)/.test(o),
  fd: (o) => /^-[^-]*[xX]/.test(o) || /^--exec(-batch)?(=|$)/.test(o),
  find: (o) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(o),
}

function isReadOnly(item: { words: string[]; rawWords: string[] }): boolean {
  const unsafe = READ_ONLY[item.rawWords[0] ?? ""]
  return unsafe !== undefined && !item.words.slice(1).some(unsafe)
}

/** The word if it may name a file: non-empty, no whitespace, not an option; the value of `--opt=value`. */
function pathWord(word: string): string | undefined {
  let value = word
  if (value.startsWith("--")) {
    const eq = value.indexOf("=")
    if (eq < 0) return
    value = value.slice(eq + 1)
  }
  if (!value || value.startsWith("-") || /\s/.test(value)) return
  return value
}

/** `cd`-family operands (also behind `builtin`/`command`); undefined when the command is not one. */
function cdOperands(rawWords: string[], words: string[]) {
  let index = 0
  while (rawWords[index] === "builtin" || rawWords[index] === "command") {
    const wrapper = rawWords[index]
    index++
    while (rawWords[index]?.startsWith("-")) {
      const flag = rawWords[index]
      index++
      if (flag === "--") break
      if (wrapper === "command" && /^-[p]*[vV]/.test(flag)) return
    }
  }
  const head = rawWords[index]
  if (!head || !CWD.has(head)) return
  if (head === "popd") return { directories: [], complete: false }

  let endOfOptions = false
  const operands: number[] = []
  for (let i = index + 1; i < words.length; i++) {
    const word = words[i]
    if (!endOfOptions && word === "--") {
      endOfOptions = true
      continue
    }
    if (endOfOptions || word === "-" || !word.startsWith("-")) operands.push(i)
  }
  if (operands.length === 0) return { directories: [], complete: false }

  const directories: string[] = []
  for (const i of operands) {
    const word = words[i]
    // `cd -` and stack rotations such as `pushd +1` have no static target; neither do expansions.
    if (word === "-" || (head === "pushd" && /^\+\d+$/.test(word)) || isDynamic(rawWords[i], word)) continue
    directories.push(word)
  }
  return { directories, complete: directories.length === operands.length }
}

/** True when the word's value depends on an expansion (`$`, backtick) outside single quotes. */
function isDynamic(raw: string | undefined, word: string) {
  const text = raw ?? word
  return /[$`]/.test(text.replace(/'[^']*'/g, ""))
}

const REDIRECTS = ["&>>", "&>", "<<<", "<<-", "<<", "<>", "<&", ">&", ">|", ">>", ">", "<"]

/**
 * Best-effort file targets of `>`, `>>`, `<`, `&>`, `>|`, `<>` in one scanned command's text.
 * Stops at the first newline after a heredoc operator, so a heredoc body is never read.
 */
function redirectTargets(text: string): { text: string; write: boolean }[] {
  const targets: { text: string; write: boolean }[] = []
  let heredoc = false
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === "\n") {
      if (heredoc) break
      i++
      continue
    }
    if (/\s/.test(char) || "|;()".includes(char)) {
      i++
      continue
    }
    const operator = REDIRECTS.find((op) => text.startsWith(op, i) && !(op.at(-1) !== "&" && text[i + op.length] === "("))
    if (operator && !(char === "&" && text[i + 1] !== ">")) {
      i = skipBlanks(text, i + operator.length)
      const word = readWord(text, i)
      i = Math.max(word.end, i + 1)
      if (operator === "<<" || operator === "<<-") heredoc = true
      if (operator === "<<" || operator === "<<-" || operator === "<<<") continue
      if (operator.endsWith("&") && /^(\d+-?|-)$/.test(word.text)) continue
      if (word.text) targets.push({ text: word.text, write: operator !== "<" })
      continue
    }
    // Any other word, including the command name and digits of `2>file`.
    i = Math.max(readWord(text, i).end, i + 1)
  }
  return targets
}

function skipBlanks(text: string, index: number) {
  while (text[index] === " " || text[index] === "\t") index++
  return index
}

/** Reads one shell word (quotes removed) up to unquoted whitespace or an operator character. */
function readWord(text: string, start: number): { text: string; end: number } {
  let out = ""
  let i = start
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (/\s/.test(char) || "|;&()".includes(char)) break
    if ((char === "<" || char === ">") && next !== "(") break
    if (char === "'") {
      const close = text.indexOf("'", i + 1)
      const end = close < 0 ? text.length : close
      out += text.slice(i + 1, end)
      i = end + 1
    } else if (char === '"') {
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && '$`"\\'.includes(text[i + 1] ?? "")) {
          out += text[i + 1]
          i += 2
        } else if (text[i] === "$" && (text[i + 1] === "(" || text[i + 1] === "{")) {
          const end = skipGroup(text, i + 1)
          out += text.slice(i, end)
          i = end
        } else if (text[i] === "`") {
          const end = skipBackticks(text, i)
          out += text.slice(i, end)
          i = end
        } else out += text[i++]
      }
      i++
    } else if (char === "\\") {
      if (next !== undefined && next !== "\n") out += next
      i += 2
    } else if ((char === "$" && (next === "(" || next === "{")) || ((char === "<" || char === ">") && next === "(")) {
      const end = skipGroup(text, i + 1)
      out += text.slice(i, end)
      i = end
    } else if (char === "`") {
      const end = skipBackticks(text, i)
      out += text.slice(i, end)
      i = end
    } else {
      out += char
      i++
    }
  }
  return { text: out, end: Math.min(i, text.length) }
}

/** Index after the group opened at `open` ("(" or "{"), quote-aware; end of text when unbalanced. */
function skipGroup(text: string, open: number): number {
  const opener = text[open]
  const closer = opener === "(" ? ")" : "}"
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (char === "\\") i++
    else if (char === "'") {
      const close = text.indexOf("'", i + 1)
      if (close < 0) return text.length
      i = close
    } else if (char === '"') {
      i++
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
    } else if (char === opener) depth++
    else if (char === closer && --depth === 0) return i + 1
  }
  return text.length
}

function skipBackticks(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++
    else if (text[i] === "`") return i + 1
  }
  return text.length
}
