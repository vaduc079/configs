// Needs pi's packages at runtime: run `npm run link-pi` once (links pi's node_modules here).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultRenderer } from "../ui.ts";

type Row = { render(width: number): string[]; handleMouse(event: unknown): unknown };
type Renderer = (message: unknown, options: { expanded: boolean }, theme: unknown) => Row;

let renderer: Renderer | undefined;
registerResultRenderer({ registerMessageRenderer: (_type: string, r: Renderer) => (renderer = r) } as unknown as ExtensionAPI);
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text };

const result = (state: string) => ({
  content: `<subagent_response sessionID="s1" state="${state}" description="find bug">\nline 1\nline 2\nline 3\nline 4\n</subagent_response>`,
  details: {
    sessionID: "s1",
    agent: "general",
    description: "find bug",
    state,
    usage: { turns: 2, input: 10, output: 5, cost: 0.01 },
    durationMs: 62_400,
  },
});
const render = (message: unknown, expanded: boolean) => renderer!(message, { expanded }, theme);
const text = (row: Row) => row.render(80).map((line) => line.trim()).filter(Boolean);
const click = (row: Row) => row.handleMouse({ type: "click", button: "left", x: 1, y: 1, width: 80, height: 3 });

test("a result shows as one row until it is clicked open", () => {
  const message = result("completed");
  const row = render(message, false);
  assert.deepEqual(text(row), ['▸ subagent general "find bug"  ✓ 1m 2s']);

  click(row);
  assert.deepEqual(text(row), [
    '▾ subagent general "find bug"  ✓ 1m 2s · 2 turns ↑10 ↓5 $0.0100',
    "sessionID: s1",
    "line 1",
    "line 2",
    "line 3",
    "line 4",
  ]);
  assert.equal(text(render(message, false)).length, 6, "the click survives a rebuild");
});

test("ctrl+o overrides a click, and pressing it again collapses the row", () => {
  const message = result("completed");
  click(render(message, false));
  assert.equal(text(render(message, true)).length, 6);
  assert.equal(text(render(message, false)).length, 1);
});

test("a failed result shows a three-line preview when collapsed", () => {
  assert.deepEqual(text(render(result("error"), false)), ['▸ subagent general "find bug"  ✗ error 1m 2s', "line 1", "line 2", "line 3"]);
});
