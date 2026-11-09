// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultRenderer } from "./result.ts";

type Row = { render(width: number): string[]; handleMouse(event: unknown): unknown };
type Renderer = (message: unknown, options: { expanded: boolean }, theme: unknown) => Row;

let renderer: Renderer | undefined;
registerResultRenderer({ registerMessageRenderer: (_type: string, r: Renderer) => (renderer = r) } as unknown as ExtensionAPI);
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text };

const result = (status: string) => ({
  content: "",
  details: {
    id: "ab12cd34",
    command: "npm test\n--watch=false",
    status,
    output: "line 1\nline 2",
    logPath: "/tmp/pi-bash-bg/ab12cd34.log",
    durationMs: 5_000,
  },
});
const text = (row: Row) => row.render(80).map((line) => line.trim()).filter(Boolean);
const click = (row: Row) => row.handleMouse({ type: "click", button: "left", x: 1, y: 1, width: 80, height: 3 });

test("a result shows as one row with the command's first line until it is clicked open", () => {
  const row = renderer!(result("exit 0"), { expanded: false }, theme);
  assert.deepEqual(text(row), ["▸ bash npm test  ✓ 5.0s"]);

  click(row);
  assert.deepEqual(text(row), ["▾ bash npm test  ✓ 5.0s", "log: /tmp/pi-bash-bg/ab12cd34.log", "line 1", "line 2"]);
});

test("a failed result names how the command ended", () => {
  assert.deepEqual(text(renderer!(result("exit 143 (SIGTERM)"), { expanded: false }, theme)), [
    "▸ bash npm test  ✗ exit 143 (SIGTERM) · 5.0s",
  ]);
});
