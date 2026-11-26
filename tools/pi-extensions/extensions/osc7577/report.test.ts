import assert from "node:assert/strict";
import { test } from "node:test";
import { osc7577, resumePairs } from "./report.ts";

// Test vectors from the spec's "Valid reports" examples.
const TOKEN = "dummy-token-replace-me";

test("clear report matches the spec's mac", () => {
  assert.equal(
    osc7577(TOKEN, 74877, 1795543200, "clear=1"),
    "\x1b]7577;pid=74877:time=1795543200:clear=1:mac=c30603369f98fef581a4098be889175b0c74f0641e49f8b25f4326cb38f97c93\x1b\\",
  );
});

test("argv and cwd report matches the spec's mac", () => {
  assert.equal(
    osc7577(TOKEN, 74877, 1795543200, "argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA=="),
    "\x1b]7577;pid=74877:time=1795543200:argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA==:mac=35cb909805c380336efd3689a125acc774a9dec8422a1d21492ebec06ca758e1\x1b\\",
  );
});

test("resumePairs base64-encodes each argv element and the cwd", () => {
  assert.equal(resumePairs(["lazygit"], "/home/user/src/project"), "argv=bGF6eWdpdA==:cwd=L2hvbWUvdXNlci9zcmMvcHJvamVjdA==");
  assert.equal(resumePairs(["pi", "--session", "x"], "/"), "argv=cGk=,LS1zZXNzaW9u,eA==:cwd=Lw==");
});
