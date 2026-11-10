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
const text = (row: Row, width = 80) => row.render(width).map((line) => line.trim()).filter(Boolean);
const click = (row: Row) => row.handleMouse({ type: "click", button: "left", x: 1, y: 1, width: 80, height: 3 });

test("a result shows as one row with the command on one line until it is clicked open, which shows it whole", () => {
  const row = renderer!(result("exit 0"), { expanded: false }, theme);
  assert.deepEqual(text(row), ["▸ bash npm test --watch=false  ✓ 5.0s"]);

  click(row);
  assert.deepEqual(text(row), [
    "▾ bash npm test --watch=false  ✓ 5.0s",
    "$ npm test",
    "--watch=false",
    "log: /tmp/pi-bash-bg/ab12cd34.log",
    "line 1",
    "line 2",
  ]);
});

test("a long command is cut to the row's width, so the status stays on the same line", () => {
  const long = { ...result("stopped by the user"), details: { ...result("").details, status: "stopped by the user", command: `cd /tmp && ${"x".repeat(200)}` } };
  for (const width of [80, 120]) {
    const [line, ...rest] = renderer!(long, { expanded: false }, theme).render(width).filter((row) => row.trim());
    assert.deepEqual(rest, [], `one line at width ${width}`);
    assert.ok(line.trimEnd().endsWith("x…  ✗ stopped by the user · 5.0s"), line);
    assert.ok(line.length <= width);
  }
});

test("a status too long for one line keeps a short cut of the command, and the line wraps", () => {
  const status = `the shell exited (exit 0) but processes it started are still running. Stop them with: kill -TERM -- -$(cat '/tmp/x.pid')`;
  const long = { ...result(""), details: { ...result("").details, status, command: "x".repeat(100) } };
  const lines = text(renderer!(long, { expanded: false }, theme));
  assert.ok(lines[0].startsWith(`▸ bash ${"x".repeat(19)}…  ✗ the shell exited`), lines[0]);
  assert.ok(lines.length > 1);
});

test("a failed result names how the command ended", () => {
  assert.deepEqual(text(renderer!(result("exit 143 (SIGTERM)"), { expanded: false }, theme)), [
    "▸ bash npm test --watch=false  ✗ exit 143 (SIGTERM) · 5.0s",
  ]);
});
