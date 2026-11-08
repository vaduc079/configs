import assert from "node:assert/strict";
import { test } from "node:test";
import { directiveProblem } from "./plugin.ts";

test("a directive with a rule and a reason passes", () => {
  assert.equal(directiveProblem(" oxlint-disable-next-line local/no-extends -- the library requires a subclass"), undefined);
  assert.equal(directiveProblem(" oxlint-disable-line local/no-extends -- the library requires a subclass"), undefined);
});

test("a directive without a reason is flagged", () => {
  assert.match(directiveProblem(" oxlint-disable-next-line local/no-extends") ?? "", /give the reason/);
  assert.match(directiveProblem(" oxlint-disable-next-line local/no-extends -- ") ?? "", /give the reason/);
  assert.match(directiveProblem(" oxlint-disable-next-line") ?? "", /give the reason/);
});

test("block-form disable and enable are flagged: only line-scoped disables are allowed", () => {
  assert.match(directiveProblem(" oxlint-disable no-var -- reason") ?? "", /Disable one line only/);
  assert.match(directiveProblem(" oxlint-disable") ?? "", /Disable one line only/);
  assert.match(directiveProblem(" oxlint-enable no-var") ?? "", /Disable one line only/);
});

test("an eslint directive is flagged", () => {
  assert.match(directiveProblem(" eslint-disable-next-line no-var -- why") ?? "", /Use `oxlint-disable`/);
});

test("rules that cannot be disabled are flagged in every spelling and directive form", () => {
  const rules = ["no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"];
  const spellings = [
    ...rules.flatMap((rule) => [`typescript/${rule}`, `@typescript-eslint/${rule}`, rule]),
    "local/boundaries",
    "boundaries",
    "local/disable-reason",
    "disable-reason",
  ];
  const forms = ["oxlint-disable", "oxlint-disable-line", "oxlint-disable-next-line", "oxlint-enable"];
  spellings.forEach((spelling) =>
    forms.forEach((form) => {
      const bare = spelling.replace(/^(local|typescript|@typescript-eslint)\//, "");
      assert.match(directiveProblem(` ${form} ${spelling} -- reason`) ?? "", new RegExp(`${bare} cannot be disabled`), `${form} ${spelling}`);
    }),
  );
});

test("a protected rule in a multi-rule list is flagged, an unprotected list passes", () => {
  assert.match(directiveProblem(" oxlint-disable-next-line prefer-const, typescript/no-unsafe-call -- reason") ?? "", /no-unsafe-call cannot be disabled/);
  assert.equal(directiveProblem(" oxlint-disable-next-line prefer-const, no-var -- reason"), undefined);
});

test("directive bypasses are flagged: extra names, a second ` -- `, a foreign prefix, no name", () => {
  assert.match(directiveProblem(" oxlint-disable-next-line typescript/no-explicit-any no-var -- probe") ?? "", /no-explicit-any cannot be disabled/);
  assert.match(directiveProblem(" oxlint-disable-next-line typescript-eslint/no-explicit-any -- probe") ?? "", /no-explicit-any cannot be disabled/);
  assert.match(directiveProblem(" oxlint-disable-next-line -- a -- b") ?? "", /Name the rule/);
  assert.equal(directiveProblem(" oxlint-disable-next-line no-var -- a -- b"), undefined);
});

test("ordinary comments pass", () => {
  ["timer boundary: a throw in a callback exits pi", "TODO: fix", "mentions oxlint-disable in the middle", ""].forEach((text) =>
    assert.equal(directiveProblem(` ${text}`), undefined, text),
  );
});
