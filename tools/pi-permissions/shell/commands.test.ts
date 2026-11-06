import { test } from "node:test"
import assert from "node:assert/strict"
import { parseShell } from "./commands.ts"

test("single command", () => {
  assert.deepEqual(parseShell("glab mr approve 12").commands, ["glab mr approve 12"])
})

test("cd target goes to directories, later command stays", () => {
  const parsed = parseShell("cd /tmp/x && glab mr approve 1")
  assert.deepEqual(parsed.directories, ["/tmp/x"])
  assert.ok(parsed.commands.includes("glab mr approve 1"))
  assert.ok(!parsed.commands.includes("cd /tmp/x"))
})

test("cd forms: wrapped, quoted, dynamic, options, pushd/popd", () => {
  assert.deepEqual(parseShell("builtin cd ~/y").directories, ["~/y"])
  assert.deepEqual(parseShell("command cd -- -weird").directories, ["-weird"])
  assert.deepEqual(parseShell("cd -L 'a b'").directories, ["a b"])
  assert.deepEqual(parseShell("pushd ../up; popd").directories, ["../up"])
  const dynamic = parseShell("cd $DIR")
  assert.deepEqual(dynamic.directories, [])
  assert.deepEqual(dynamic.commands, ["cd $DIR"])
  assert.deepEqual(parseShell("cd -").directories, [])
})

test("list and pipe give one command each", () => {
  assert.deepEqual(parseShell("git status; brew install jq | tee log").commands, [
    "git status",
    "brew install jq",
    "tee log",
  ])
})

test("path words from arguments", () => {
  assert.ok(parseShell("cat .env | pbcopy").pathWords.includes(".env"))
  assert.ok(parseShell("cp ~/.ssh/id_rsa .").pathWords.includes("~/.ssh/id_rsa"))
})

test("--opt=value gives the value; flags are skipped", () => {
  const { pathWords } = parseShell("tool --file=secrets/.env --verbose -x --empty=")
  assert.ok(pathWords.includes("secrets/.env"))
  assert.ok(!pathWords.some((word) => word.startsWith("-") || word === ""))
})

test("redirect targets are path words", () => {
  assert.ok(parseShell("echo x > protected.json").pathWords.includes("protected.json"))
  assert.ok(parseShell("echo x >>log.txt").pathWords.includes("log.txt"))
  assert.ok(parseShell("sort <in.txt").pathWords.includes("in.txt"))
  assert.ok(parseShell("echo a 2>err.log").pathWords.includes("err.log"))
  assert.deepEqual(parseShell("echo a &> 'out file'").pathWords, ["a"])
  assert.ok(parseShell("echo a > \"$HOME/.ssh/x\"").pathWords.includes("$HOME/.ssh/x"))
  assert.ok(parseShell("cat <in.txt >out.txt -n foo").pathWords.includes("out.txt"))
  assert.ok(parseShell("> only.txt").pathWords.includes("only.txt"))
  assert.ok(parseShell("(echo hi) > grp.txt").pathWords.includes("grp.txt"))
})

test("fd duplication and here-strings are not files", () => {
  const { pathWords } = parseShell("echo a 2>&1 >&2 <<< 'text here'")
  assert.deepEqual(pathWords, ["a"])
})

test("quoted words with spaces are not path words", () => {
  const { pathWords } = parseShell('git commit -m "update .env loading"')
  assert.ok(!pathWords.some((word) => /\s/.test(word)))
  assert.ok(!pathWords.some((word) => word.includes(".env")))
})

test("a redirect operator inside quotes is not a redirect", () => {
  assert.deepEqual(parseShell('echo "a > b.txt"').pathWords, [])
})

test("heredoc body never yields path words", () => {
  const body = "glab mr create --description \"$(cat <<'EOF'\nmentions .env and > stolen.txt\nEOF\n)\""
  const parsed = parseShell(body)
  assert.ok(!parsed.pathWords.some((word) => word.includes(".env") || word.includes("stolen") || /\s/.test(word)))
  const bare = parseShell("cat <<EOF > out.txt\nbody .env > no.txt\nEOF")
  assert.deepEqual(bare.pathWords, ["out.txt"])
})

test("unreadable command returns the raw command, nothing else", () => {
  const parsed = parseShell("  cat 'unterminated .env  ")
  assert.deepEqual(parsed, { commands: ["cat 'unterminated .env"], directories: [], pathWords: [] })
})

test("never throws", () => {
  for (const input of ["", "   ", "echo 'unterminated", "x".repeat(70_000), "echo $(", "\\"]) {
    const parsed = parseShell(input)
    assert.ok(Array.isArray(parsed.commands))
  }
})

test("commands are the unquoted words joined by single spaces", () => {
  assert.deepEqual(parseShell("GITLAB_HOST=x glab mr approve 1").commands, ["glab mr approve 1"])
  assert.deepEqual(parseShell("HOMEBREW_NO_AUTO_UPDATE=1 brew install jq").commands, ["brew install jq"])
  assert.deepEqual(parseShell("glab  mr approve 1").commands, ["glab mr approve 1"])
})

test("cd operands are directories, not path words", () => {
  assert.deepEqual(parseShell("cd ~/x && ls").pathWords, [])
  assert.deepEqual(parseShell("cd ~/x && cat a").pathWords, ["a"])
})
