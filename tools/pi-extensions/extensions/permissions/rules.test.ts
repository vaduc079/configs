import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { decide, evaluate, expandHome, loadRules, match, parseRules } from "./rules.ts";
import type { Check, Rule } from "./types.ts";

const HOME = "/home/x";

describe("match", () => {
  it("* crosses /", () => {
    assert.ok(match("a/b/c.env", "*.env"));
    assert.ok(match("/home/x/.ssh/id_rsa", "/home/x/.ssh/*"));
  });
  it("trailing ' *' is optional", () => {
    assert.ok(match("git", "git *"));
    assert.ok(match("git status", "git *"));
    assert.ok(!match("gitx", "git *"));
  });
  it("? matches one char", () => {
    assert.ok(match("a1", "a?"));
    assert.ok(!match("a", "a?"));
    assert.ok(!match("a12", "a?"));
  });
  it("escapes regex chars", () => {
    assert.ok(match("a.env", "a.env"));
    assert.ok(!match("axenv", "a.env"));
  });
});

describe("expandHome", () => {
  it("expands ~ and $HOME", () => {
    assert.equal(expandHome("~/a", HOME), "/home/x/a");
    assert.equal(expandHome("$HOME/a", HOME), "/home/x/a");
    assert.equal(expandHome("~", HOME), HOME);
    assert.equal(expandHome("a/~/b", HOME), "a/~/b");
  });
});

describe("parseRules", () => {
  const json = (permissions: unknown) => JSON.stringify({ permissions });

  it("expands home only for read, edit, external_directory", () => {
    const rules = parseRules(
      json([
        { action: "read", resource: "~/a", effect: "deny" },
        { action: "edit", resource: "$HOME/b", effect: "deny", reason: "no" },
        { action: "external_directory", resource: "~/c/*", effect: "allow" },
        { action: "shell", resource: "cat ~/d", effect: "ask" },
        { action: "mcp__x__y", resource: "~/e", effect: "ask" },
      ]),
      HOME,
    );
    assert.deepEqual(
      rules.map((r) => r.resource),
      ["/home/x/a", "/home/x/b", "/home/x/c/*", "cat ~/d", "~/e"],
    );
    assert.equal(rules[1].reason, "no");
  });
  it("rejects bad JSON", () => {
    assert.throws(() => parseRules("{nope", HOME), /invalid JSON/);
  });
  it("rejects missing permissions array", () => {
    assert.throws(() => parseRules("{}", HOME), /permissions/);
  });
  it("rejects bad effect, naming the index", () => {
    assert.throws(
      () =>
        parseRules(
          json([
            { action: "a", resource: "b", effect: "allow" },
            { action: "a", resource: "b", effect: "maybe" },
          ]),
          HOME,
        ),
      /permissions\[1\].*effect/,
    );
  });
  it("rejects non-string action, resource, reason", () => {
    assert.throws(() => parseRules(json([{ action: 1, resource: "b", effect: "allow" }]), HOME), /\[0\].*action/);
    assert.throws(() => parseRules(json([{ action: "a", resource: 2, effect: "allow" }]), HOME), /\[0\].*resource/);
    assert.throws(
      () => parseRules(json([{ action: "a", resource: "b", effect: "allow", reason: 3 }]), HOME),
      /\[0\].*reason/,
    );
    assert.throws(() => parseRules(json(["x"]), HOME), /\[0\]/);
  });
  it("input: a string becomes a one-item list; arrays stay", () => {
    const rules = parseRules(
      json([{ action: "a", resource: "*", effect: "allow", input: { channel_id: "C1", thread_ts: ["1", "2"] } }]),
      HOME,
    );
    assert.deepEqual(rules[0].input, { channel_id: ["C1"], thread_ts: ["1", "2"] });
  });
  it("input: rejected on ask and deny rules and when malformed", () => {
    const rule = (effect: string, input: unknown) => json([{ action: "a", resource: "*", effect, input }]);
    assert.throws(() => parseRules(rule("deny", { c: "x" }), HOME), /\[0\].*only allowed on allow rules/);
    assert.throws(() => parseRules(rule("ask", { c: "x" }), HOME), /only allowed on allow rules/);
    for (const bad of [null, "x", ["x"], {}]) {
      assert.throws(() => parseRules(rule("allow", bad), HOME), /"input" must be a non-empty object/, JSON.stringify(bad));
    }
    for (const bad of [1, [], [1], null]) {
      assert.throws(() => parseRules(rule("allow", { c: bad }), HOME), /"input\.c" must be/, JSON.stringify(bad));
    }
  });
  it("loadRules throws on a missing file and reads a present one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pp-"));
    assert.throws(() => loadRules(path.join(dir, "nope.json"), HOME), /cannot read/);
    const file = path.join(dir, "p.json");
    writeFileSync(file, json([{ action: "*", resource: "*", effect: "allow" }]));
    assert.equal(loadRules(file, HOME).length, 1);
  });
});

describe("evaluate", () => {
  const rules: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "deny" },
    { action: "read", resource: "*.env.example", effect: "allow" },
  ];
  it("last match wins", () => {
    assert.equal(evaluate("read", "a.env", rules).effect, "deny");
    assert.equal(evaluate("read", "a.env.example", rules).effect, "allow");
    assert.equal(evaluate("edit", "a.env", rules).effect, "allow");
  });
  it("no match → ask", () => {
    assert.deepEqual(evaluate("read", "x", []), { action: "read", resource: "*", effect: "ask" });
  });
  it("input rule matches only when every field is a string matching one of its patterns", () => {
    const withInput: Rule[] = [
      { action: "send", resource: "*", effect: "ask" },
      { action: "send", resource: "*", effect: "allow", input: { channel_id: ["C1", "D*"], kind: ["msg"] } },
    ];
    const effect = (input: Record<string, unknown>) => evaluate("send", "*", withInput, input).effect;
    assert.equal(effect({ channel_id: "C1", kind: "msg", extra: 1 }), "allow");
    assert.equal(effect({ channel_id: "D9", kind: "msg" }), "allow");
    assert.equal(effect({ channel_id: "C1" }), "ask");
    assert.equal(effect({ channel_id: "C2", kind: "msg" }), "ask");
    assert.equal(effect({ channel_id: ["C1"], kind: "msg" }), "ask");
  });
});

describe("decide", () => {
  const allowAll: Rule = { action: "*", resource: "*", effect: "allow" };
  const check = (action: string, resources: string[], denyOnly?: boolean): Check => ({ action, resources, denyOnly });

  it("allow when everything allows", () => {
    assert.deepEqual(decide([check("read", ["a"])], [allowAll]), { effect: "allow" });
    assert.deepEqual(decide([], []), { effect: "allow" });
  });
  it("deny beats ask", () => {
    const rules: Rule[] = [
      allowAll,
      { action: "shell", resource: "git push *", effect: "ask" },
      { action: "read", resource: "*.env", effect: "deny", reason: "secret" },
    ];
    const d = decide([check("shell", ["git push x"]), check("read", ["a.env"])], rules);
    assert.equal(d.effect, "deny");
    assert.equal(d.rule?.reason, "secret");
    assert.equal(d.resource, "a.env");
    assert.equal(d.check?.action, "read");
  });
  it("ask from a normal check", () => {
    const rules: Rule[] = [allowAll, { action: "shell", resource: "glab mr approve *", effect: "ask" }];
    const d = decide([check("shell", ["ls", "glab mr approve 1"])], rules);
    assert.equal(d.effect, "ask");
    assert.equal(d.resource, "glab mr approve 1");
  });
  it("unmatched → ask with synthetic rule", () => {
    const d = decide([check("mcp__a__b", ["*"])], []);
    assert.equal(d.effect, "ask");
    assert.deepEqual(d.rule, { action: "mcp__a__b", resource: "*", effect: "ask" });
  });
  it("denyOnly ask is ignored", () => {
    const rules: Rule[] = [allowAll, { action: "read", resource: "*", effect: "ask" }];
    assert.deepEqual(decide([check("read", ["a"], true)], rules), { effect: "allow" });
  });
  it("denyOnly deny counts", () => {
    const rules: Rule[] = [allowAll, { action: "edit", resource: "*.env", effect: "deny" }];
    const d = decide([check("edit", ["a.env"], true)], rules);
    assert.equal(d.effect, "deny");
    assert.equal(d.check?.denyOnly, true);
  });
  it("multi-resource: strictest wins", () => {
    const rules: Rule[] = [
      allowAll,
      { action: "read", resource: "/abs/secret", effect: "deny" },
      { action: "read", resource: "rel/ask", effect: "ask" },
    ];
    assert.equal(decide([check("read", ["ok", "rel/ask"])], rules).effect, "ask");
    assert.equal(decide([check("read", ["rel/ask", "/abs/secret"])], rules).effect, "deny");
    assert.equal(decide([check("read", ["ok", "fine"])], rules).effect, "allow");
  });
});

describe("match: posix only, file-name anchored env rules", () => {
  it("backslash is a literal character, not a slash", () => {
    assert.equal(match("\\.env", "*/.env"), false);
    assert.equal(match("a\\b", "a/b"), false);
    assert.equal(match("a\\b", "a\\b"), true);
  });
  it("env rules anchor on the file name", () => {
    const rules: Rule[] = [{ action: "*", resource: "*", effect: "allow" }];
    for (const action of ["read", "edit"]) {
      for (const resource of [".env", "*/.env", ".env.*", "*/.env.*", ".shenv", "*/.shenv"]) rules.push({ action, resource, effect: "deny" });
      for (const resource of [".env.example", "*/.env.example"]) rules.push({ action, resource, effect: "allow" });
    }
    for (const action of ["read", "edit"]) {
      for (const r of [".env", "sub/.env", "/abs/p/.env", ".env.local", "a/.env.local", ".shenv", "/x/.shenv"]) {
        assert.equal(evaluate(action, r, rules).effect, "deny", `${action} ${r}`);
      }
      for (const r of [".env.example", "a/.env.example", "\\.env", "process.env.API", "!*.env", "src/env.ts", "x.env"]) {
        assert.equal(evaluate(action, r, rules).effect, "allow", `${action} ${r}`);
      }
    }
  });
});
