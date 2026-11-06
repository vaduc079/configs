import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { classify } from "./classify.ts";
import { decide, parseRules } from "./rules.ts";
import { parseShell } from "./shell/commands.ts";
import type { Location, Rule, ShellParse } from "./types.ts";

const noShell = (): ShellParse => ({ commands: [], directories: [], pathWords: [] });
const loc: Location = { cwd: "/home/x/proj", root: "/home/x/proj", home: "/home/x" };
const locRoot: Location = { cwd: "/home/x/proj/sub", root: "/home/x/proj", home: "/home/x" };

describe("path tools", () => {
  for (const [tool, action] of [
    ["read", "read"],
    ["grep", "read"],
    ["find", "read"],
    ["ls", "read"],
    ["write", "edit"],
    ["edit", "edit"],
  ] as const) {
    it(`${tool} inside → ${action} check with relative and absolute forms`, () => {
      assert.deepEqual(classify(tool, { path: "src/a.ts" }, loc, noShell), [
        { action, resources: ["src/a.ts", "/home/x/proj/src/a.ts"] },
      ]);
    });
    it(`${tool} outside → external_directory first`, () => {
      assert.deepEqual(classify(tool, { path: "/etc/hosts" }, loc, noShell), [
        { action: "external_directory", resources: ["/etc/*"] },
        { action, resources: ["../../../etc/hosts", "/etc/hosts"] },
      ]);
    });
  }

  it("absolute path inside cwd: same two forms, deduped", () => {
    assert.deepEqual(classify("read", { path: "/home/x/proj/a" }, loc, noShell), [
      { action: "read", resources: ["a", "/home/x/proj/a"] },
    ]);
  });
  it("missing path for grep/find/ls → cwd", () => {
    for (const tool of ["grep", "find", "ls"]) {
      assert.deepEqual(classify(tool, {}, loc, noShell), [{ action: "read", resources: [".", "/home/x/proj"] }]);
    }
  });
  it("odd input never throws", () => {
    for (const input of [undefined, null, 5, "x", { path: 7 }, { path: null }]) {
      assert.doesNotThrow(() => classify("read", input, loc, noShell));
      assert.deepEqual(classify("ls", input, loc, noShell), [{ action: "read", resources: [".", "/home/x/proj"] }]);
      assert.doesNotThrow(() => classify("bash", input, loc, noShell));
    }
  });
  it("git root counts as inside even when cwd is a subdirectory", () => {
    assert.deepEqual(classify("read", { path: "../a.ts" }, locRoot, noShell), [
      { action: "read", resources: ["../a.ts", "/home/x/proj/a.ts"] },
    ]);
    const out = classify("read", { path: "/home/x/other/a.ts" }, locRoot, noShell);
    assert.equal(out[0].action, "external_directory");
  });
  it("sibling with the same prefix is outside", () => {
    const out = classify("read", { path: "/home/x/proj-two/a" }, loc, noShell);
    assert.deepEqual(out[0], { action: "external_directory", resources: ["/home/x/proj-two/*"] });
  });
  it("~ paths expand to home", () => {
    assert.deepEqual(classify("read", { path: "~/.ssh/id_rsa" }, loc, noShell), [
      { action: "external_directory", resources: ["/home/x/.ssh/*"] },
      { action: "read", resources: ["../.ssh/id_rsa", "/home/x/.ssh/id_rsa"] },
    ]);
  });
  it("existing directory uses itself, not its dirname", () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "cls-")));
    mkdirSync(path.join(dir, "d"));
    const out = classify("ls", { path: path.join(dir, "d") }, loc, noShell);
    assert.deepEqual(out[0], { action: "external_directory", resources: [`${dir}/d/*`] });
    const file = classify("read", { path: path.join(dir, "missing.txt") }, loc, noShell);
    assert.deepEqual(file[0], { action: "external_directory", resources: [`${dir}/*`] });
  });
});

describe("bash", () => {
  it("shell check with commands; empty lists skipped", () => {
    const parse = (): ShellParse => ({ commands: ["git status", "ls"], directories: [], pathWords: [] });
    assert.deepEqual(classify("bash", { command: "git status && ls" }, loc, parse), [
      { action: "shell", resources: ["git status", "ls"] },
    ]);
    assert.deepEqual(classify("bash", { command: "" }, loc, noShell), []);
  });
  it("cd outside adds external_directory; cd inside does not", () => {
    const parse = (): ShellParse => ({ commands: ["cd /tmp/zzz"], directories: ["/tmp/zzz", "sub", "~/other"], pathWords: [] });
    assert.deepEqual(classify("bash", { command: "x" }, loc, parse), [
      { action: "external_directory", resources: ["/tmp/*"] },
      { action: "external_directory", resources: ["/home/x/*"] },
      { action: "shell", resources: ["cd /tmp/zzz"] },
    ]);
  });
  it("path words → denyOnly read and edit with both forms", () => {
    const parse = (): ShellParse => ({ commands: ["cat .env"], directories: [], pathWords: [".env", "~/.ssh/id_rsa", ".env"] });
    assert.deepEqual(classify("bash", { command: "cat .env" }, loc, parse), [
      { action: "shell", resources: ["cat .env"] },
      { action: "read", resources: [".env", "/home/x/proj/.env", "../.ssh/id_rsa", "/home/x/.ssh/id_rsa"], denyOnly: true },
      { action: "edit", resources: [".env", "/home/x/proj/.env", "../.ssh/id_rsa", "/home/x/.ssh/id_rsa"], denyOnly: true },
    ]);
  });
  it("path words that only ask never prompt, but deny blocks", () => {
    const rules = parseRules(
      JSON.stringify({
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "deny" },
          { action: "read", resource: "notes*", effect: "ask" },
        ],
      }),
      "/home/x",
    );
    const parse = (words: string[]) => (): ShellParse => ({ commands: ["c"], directories: [], pathWords: words });
    assert.equal(decide(classify("bash", { command: "c" }, loc, parse(["notes.txt"])), rules).effect, "allow");
    assert.equal(decide(classify("bash", { command: "c" }, loc, parse(["a.env"])), rules).effect, "deny");
  });
});

describe("other tools", () => {
  it("codemode yields no checks", () => {
    assert.deepEqual(classify("codemode", { code: "x" }, loc, noShell), []);
  });
  it("MCP and unknown tools → action = tool name", () => {
    assert.deepEqual(classify("mcp__slack__slack_send_message", { text: "hi" }, loc, noShell), [
      { action: "mcp__slack__slack_send_message", resources: ["*"] },
    ]);
    assert.deepEqual(classify("whatever", undefined, loc, noShell), [{ action: "whatever", resources: ["*"] }]);
  });
});

describe("relative and absolute rules both apply", () => {
  const rules = parseRules(
    JSON.stringify({
      permissions: [
        { action: "*", resource: "*", effect: "allow" },
        { action: "edit", resource: "*.env", effect: "deny" },
        { action: "edit", resource: "/home/x/proj/protected.json", effect: "deny" },
        { action: "edit", resource: "~/.pi/agent/permissions.json", effect: "deny" },
      ],
    }),
    "/home/x",
  );
  it("relative path hit by an absolute rule", () => {
    const d = decide(classify("write", { path: "protected.json" }, loc, noShell), rules);
    assert.equal(d.effect, "deny");
    assert.equal(d.rule?.resource, "/home/x/proj/protected.json");
  });
  it("relative path hit by *.env", () => {
    const d = decide(classify("edit", { path: "config/.env" }, loc, noShell), rules);
    assert.equal(d.effect, "deny");
    assert.equal(d.rule?.resource, "*.env");
  });
  it("~ path hits an expanded home rule", () => {
    const d = decide(classify("edit", { path: "~/.pi/agent/permissions.json" }, loc, noShell), rules);
    assert.equal(d.effect, "deny");
  });
  it("unrelated path allowed", () => {
    assert.equal(decide(classify("edit", { path: "src/a.ts" }, loc, noShell), rules).effect, "allow");
  });
});

describe("$HOME expansion", () => {
  const homeRules: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "/home/x/.pgpass", effect: "deny" },
    { action: "read", resource: "/home/x/.ssh/*", effect: "deny" },
  ];
  it("$HOME/ and ${HOME}/ words resolve like ~/ (scanner reports them as words; parseShell keeps the raw text)", () => {
    for (const command of ["cat $HOME/.pgpass", 'cat "$HOME/.ssh/id_rsa"', "cat ${HOME}/.ssh/id_rsa"]) {
      const d = decide(classify("bash", { command }, loc, parseShell), homeRules);
      assert.equal(d.effect, "deny", command);
    }
  });
  it("tool paths and cd directories expand $HOME too", () => {
    assert.equal(decide(classify("read", { path: "$HOME/.pgpass" }, loc, noShell), homeRules).effect, "deny");
    assert.deepEqual(classify("read", { path: "${HOME}/a" }, loc, noShell)[0], {
      action: "external_directory",
      resources: ["/home/x/*"],
    });
    const shell = (): ShellParse => ({ commands: [], directories: ["$HOME/zz"], pathWords: [] });
    assert.deepEqual(classify("bash", { command: "cd $HOME/zz" }, loc, shell), [
      { action: "external_directory", resources: ["/home/x/*"] },
    ]);
  });
});

describe("pi path normalisation for file tools", () => {
  const denyRules: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*/.env", effect: "deny" },
    { action: "read", resource: "/home/x/.ssh/*", effect: "deny" },
    { action: "read", resource: "/home/x/.pgpass", effect: "deny" },
    { action: "edit", resource: "/home/x/configs/tools/pi-permissions/*", effect: "deny" },
  ];
  const effect = (tool: string, p: string) => decide(classify(tool, { path: p }, loc, noShell), denyRules).effect;
  it("a leading @ is stripped", () => {
    assert.equal(effect("read", "@.env"), "deny");
    assert.equal(effect("read", "@~/.ssh/id_rsa"), "deny");
    assert.equal(effect("edit", "@~/configs/tools/pi-permissions/index.ts"), "deny");
  });
  it("only one leading @ is stripped", () => {
    assert.equal(effect("read", "@@.env"), "allow");
  });
  it("a file:// URL becomes a path", () => {
    assert.equal(effect("read", "file:///home/x/.pgpass"), "deny");
  });
  it("Unicode spaces become spaces", () => {
    assert.deepEqual(classify("read", { path: "a b" }, loc, noShell), [
      { action: "read", resources: ["a b", "/home/x/proj/a b"] },
    ]);
  });
  it("shell path words keep a literal @", () => {
    const d = decide(classify("bash", { command: "cat @.env" }, loc, parseShell), denyRules);
    assert.equal(d.effect, "allow");
  });
});

describe("directory operands", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "pi-cls-"));
  const secretDir = path.join(tmp, "secret");
  mkdirSync(secretDir);
  const tloc: Location = { cwd: tmp, root: tmp, home: tmp };
  const dirRules: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: `${secretDir}/*`, effect: "deny" },
    { action: "edit", resource: `${secretDir}/*`, effect: "deny" },
  ];
  it("existing directory adds abs + '/' so <dir>/* matches", () => {
    assert.ok(classify("read", { path: "secret" }, tloc, noShell).some((c) => c.resources.includes(secretDir + "/")));
    for (const command of ["cp -r secret x", `rm -rf ${secretDir}`, "cp -r ~/secret x"]) {
      assert.equal(decide(classify("bash", { command }, tloc, parseShell), dirRules).effect, "deny", command);
    }
  });
  it("a missing path or a file gets no trailing-slash form", () => {
    writeFileSync(path.join(tmp, "f"), "");
    for (const p of ["nope", "f"]) {
      const resources = classify("read", { path: p }, tloc, noShell).flatMap((c) => c.resources);
      assert.ok(!resources.some((r) => r.endsWith("/")), p);
    }
  });
  it("sibling directory with the same prefix does not match", () => {
    mkdirSync(path.join(tmp, "secret2"), { recursive: true });
    assert.equal(decide(classify("bash", { command: "cp -r secret2 x" }, tloc, parseShell), dirRules).effect, "allow");
  });
});

describe("shell glob words", () => {
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "pi-glob-")));
  mkdirSync(path.join(tmp, "config"));
  writeFileSync(path.join(tmp, ".env"), "");
  writeFileSync(path.join(tmp, "README.md"), "");
  writeFileSync(path.join(tmp, "config", ".env.prod"), "");
  const gloc: Location = { cwd: tmp, root: tmp, home: tmp };
  const rules: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: ".env", effect: "deny" },
    { action: "read", resource: "*/.env", effect: "deny" },
    { action: "read", resource: ".env.*", effect: "deny" },
    { action: "read", resource: "*/.env.*", effect: "deny" },
  ];
  const effect = (command: string) => decide(classify("bash", { command }, gloc, parseShell), rules).effect;
  for (const command of ["cat .env*", "head -5 config/.env*", "cat {.env,README.md}", "cat .en?", "cat {.env,../x}", "cat {config/../.env,README.md}"]) {
    it(`${command} → deny`, () => assert.equal(effect(command), "deny"));
  }
  it("a glob with no secret match → allow", () => assert.equal(effect("cat *.md"), "allow"));
  it("no matches or a bad pattern does not throw", () => {
    for (const command of ["cat nomatch*", "cat [", "cat {a"]) {
      assert.doesNotThrow(() => classify("bash", { command }, gloc, parseShell), command);
    }
  });
  it("matches per word are capped", () => {
    const many = path.join(tmp, "many");
    mkdirSync(many);
    for (let i = 0; i < 300; i++) writeFileSync(path.join(many, `f${i}`), "");
    const checks = classify("bash", { command: "cat many/*" }, gloc, parseShell);
    const read = checks.find((c) => c.action === "read");
    // literal word + 200 matches, 2 forms each; 300 uncapped matches would give 602
    assert.ok(read && read.resources.length <= 2 * 201, String(read?.resources.length));
  });
  it("** and *** do not recurse (bash 3.2 has no globstar)", () => {
    const deep = path.join(tmp, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    writeFileSync(path.join(tmp, "a", ".env"), "");
    writeFileSync(path.join(deep, ".env"), "");
    for (const command of ["cat **/.env", "cat ***/.env"]) {
      const resources = classify("bash", { command }, gloc, parseShell).flatMap((c) => c.resources);
      assert.ok(resources.includes(path.join(tmp, "a", ".env")), command);
      assert.ok(!resources.some((r) => r.includes("a/b/c/.env")), `${command}: ${resources.join(",")}`);
    }
  });
  it("a brace range is not expanded", () => {
    const start = Date.now();
    classify("bash", { command: "echo {1..100000}" }, gloc, parseShell);
    assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
  });
});
