import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { capText } from "./output.ts";

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-output-")), "nested", "full.md");

test("text within the limits is returned unchanged and nothing is saved", () => {
  const full = file();
  assert.deepEqual(capText("a\nb", full), { text: "a\nb" });
  assert.equal(fs.existsSync(full), false);
});

test("more than 2,000 lines keeps the first 2,000 and saves the full text", () => {
  const full = file();
  const text = Array.from({ length: 2_001 }, (_, i) => `line ${i + 1}`).join("\n");
  const capped = capText(text, full);
  assert.equal(capped.fullOutputPath, full);
  assert.equal(fs.readFileSync(full, "utf8"), text);
  assert.ok(capped.text.endsWith(`line 2000\n[showing lines 1-2000 of 2001; full output saved to ${full}]`));
});

test("more than 50 KB keeps the leading lines that fit", () => {
  const line = "x".repeat(1_023); // 1 KB with its newline
  const capped = capText(Array.from({ length: 60 }, () => line).join("\n"), file());
  assert.match(capped.text, /\[showing lines 1-50 of 60; /);
});
