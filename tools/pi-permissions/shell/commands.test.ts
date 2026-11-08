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

test("read-only commands give read-only path words", () => {
  for (const cmd of [
    "ls -la a", "cat a", "head -n 5 a", "rg -n x a", "fd -t f x a", "find a -name x", "wc -l a", "jq . a",
    "rg -n x a | head -5", "cat a | wc -l", "head -n 5 < a", "rg -g '*.ts' x a", "cd /tmp && ls a", "2>/dev/null ls a",
    'rg "TODO.*" a', "rg x=y a", "cat a < $F",
  ]) {
    const parsed = parseShell(cmd)
    assert.ok(parsed.readPathWords.includes("a"), cmd)
    assert.ok(!parsed.pathWords.includes("a"), cmd)
  }
})

test("write or exec options, wrappers and other commands keep the edit check", () => {
  for (const cmd of [
    "rm a", "sed -i '' s/x/y/ a", "tee a", "sort -o a b",
    "find a -delete", "find a -exec rm {} ;", "fd x a -x rm", "fd -HX rm x a", "fd --exec rm x a", "rg --pre ./run x a",
    "env cat a", "xargs cat a", "command ls a", "exec cat a", "rg --hostname-bin=./run x a", "fd -0x rm . a",
  ]) assert.ok(parseShell(cmd).pathWords.includes("a"), cmd)
})

test("output of a read-only command reaching a writer keeps the edit check", () => {
  for (const cmd of [
    'rm "$(realpath a)"', "ls -d a | xargs rm", "rg -l x a | xargs sed -i '' s/x/y/",
    "for f in $(ls a); do rm $f; done", 'while read f; do rm "$f"; done < <(ls a)', "rm b < a",
  ]) assert.ok(parseShell(cmd).pathWords.includes("a"), cmd)
})

test("a dynamic write target or another command in the line keeps the edit check", () => {
  for (const cmd of [
    'F=$(realpath a); cat /tmp/x > "$F"', 'cat /tmp/x > "$(realpath a)"', 'cat /tmp/x >> "$(readlink -f a)"',
    'cat(){ rm "$@"; }; cat a', "cd $(rm a) && ls a",
  ]) assert.ok(parseShell(cmd).pathWords.includes("a"), cmd)
})

test("a write redirect on a read-only command is still an edit", () => {
  const parsed = parseShell("cat src > a")
  assert.ok(parsed.pathWords.includes("a"))
  assert.ok(parsed.readPathWords.includes("src"))
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
  assert.deepEqual(parsed, { commands: ["cat 'unterminated .env"], directories: [], pathWords: [], readPathWords: [] })
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
  assert.deepEqual(parseShell("cd ~/x && cat a").readPathWords, ["a"])
})
