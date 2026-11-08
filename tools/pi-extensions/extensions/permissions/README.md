# pi-permissions

Pi extension that gates every tool call with OpenCode-style `allow` / `ask` / `deny` rules (last matching rule wins).
Deny blocks the call and tells the model why. Ask opens an Allow / Deny / Deny with reason dialog (blocks when no UI, e.g. `pi -p`, or in a pi-subagents child).
`codemode` is not gated itself; the MCP calls nested inside it are.

## Rules file

`~/.pi/agent/permissions.json`, or the path in `PI_PERMISSIONS_FILE`. Loaded at startup and on `session_start`.
If it fails to load, every tool call is blocked until it is fixed.

An `allow` rule can carry `input`: it then matches only when every named tool-input field is a string matching one of its patterns (same wildcards as `resource`). Use it to make exceptions to an earlier `ask` rule:

```json
{ "action": "mcp__slack__slack_send_message", "resource": "*", "input": { "channel_id": ["C0123", "U0456"] }, "effect": "allow" }
```

A missing or non-string field never matches, so the earlier rule applies. `input` is matched against the raw tool input, and like any later allow rule it also overrides earlier deny rules, so name the exact tool in `action`. `input` on an `ask` or `deny` rule is a load error. A matching exception also applies in pi-subagents children.

Shell path words containing `* ? [ {` are also checked as their glob expansion (runs of two or more `*` are treated as `*`, as in bash 3.2 which has no globstar; at most 200 matches per word; words with a brace range such as `{1..9}` or `{a..z}` are left unexpanded).

## Enable and test

Part of the pi-extensions package: see `../../AGENTS.md` for setup and `npm run check`.

## Known gaps

- Editing `~/.pi/agent/settings.json` (e.g. removing the pi-extensions package from `packages`) is not denied unless your rules deny it.
- The `grep`, `find` and `ls` tools are checked on the path given, not on files inside a directory that holds secrets.
- Case variants such as `.ENV` are not matched (rules are case-sensitive; APFS is not).
- Relative paths after `cd` in the same command resolve against the session cwd, not the `cd` target.
- Interpreter one-liners (`node -e`, `python -c`), `bash -c`, `eval` and shell variables are not read for paths.
- Wrapper commands (`env X=1 …`, `sudo`, `xargs`, `time`, `command`) hide the real command from rules.
- Options before a subcommand slip past a command rule: `glab --repo x mr approve` does not match `glab mr approve *`.
- `git show HEAD:.env` reads a secret without naming a path word.
- The 200-match cap lets `cat {f*,.env}` through when a directory has more than 200 matches.
- Quoted glob words are expanded too, so they over-deny.
- Words with a brace range skip glob expansion, so `cat .env{,.{1..2}}` slips; `*{*,}` still walks the tree (about 24 s freeze); products of brace lists (`{a,b}{a,b}…`, `{0,…,9}` ×5) can also freeze pi for seconds, up to about 30 s.
- Deep words like `*/*/*/*/*/*` can take seconds: the 200 cap limits results, not work.
- The brace-range check also skips `{a..5}` and `{1..9..2}`, which bash 3.2 leaves literal, so the contrived `cat {.env,{a..5}}` slips.
- `prompt.test.ts` pins the order of `TARGET_KEYS`, so reordering them fails a test.
