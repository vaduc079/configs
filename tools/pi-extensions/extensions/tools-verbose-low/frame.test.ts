import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  type ExtensionAPI,
  initTheme,
  ToolExecutionComponent,
  type ToolRendererResolver,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, type TUI } from "@earendil-works/pi-tui";
import quietToolRows from "./index.ts";
import { quietLine } from "./frame.ts";

initTheme("dark", false);

const cwd = process.cwd();
const ui = { requestRender() {} } as unknown as TUI;
const WIDTH = 80;

let resolver: ToolRendererResolver | undefined;
process.env.PI_CODING_AGENT_DIR = mkdtempSync(path.join(tmpdir(), "pi-agent-")); // no config file: normal mode
quietToolRows({
  registerToolRenderer: (r: ToolRendererResolver) => (resolver = r),
  registerCommand() {},
  on() {},
} as unknown as ExtensionAPI);
const wrapped = (toolName: string, base: ToolRenderers | undefined) => resolver!(toolName, () => base);

/**
 * The look to keep: pi's default shell, with renderers that show the quiet line when collapsed and
 * otherwise defer to the tool, throwing so pi draws its own fallback when the tool has no renderer.
 */
function defaultShellRow(toolName: string, base: ToolRenderers | undefined): ToolRenderers {
  return {
    renderShell: "default",
    renderCall(args, theme, context) {
      const call = base?.renderCall?.(args, theme, { ...context, lastComponent: context.state.call });
      context.state.call = call;
      if (!context.expanded) return quietLine(toolName, context, theme);
      if (!call) throw new Error("use pi's fallback");
      return call;
    },
    renderResult(result, options, theme, context) {
      const component = base?.renderResult?.(result, options, theme, { ...context, lastComponent: context.state.result });
      context.state.result = component;
      if (!options.expanded && !context.isError) return new Text("", 0, 0);
      if (!component) throw new Error("use pi's fallback");
      return component;
    },
  };
}

type Result = { content: { type: "text"; text: string }[]; details?: unknown; isError: boolean; durationMs: number };
interface Row {
  args: Record<string, unknown>;
  result?: Result;
  expanded?: boolean;
  outputPad?: number;
}

function render(toolName: string, definition: ToolRenderers | undefined, row: Row): string[] {
  const component = new ToolExecutionComponent(toolName, "call-1", row.args, { outputPad: row.outputPad }, definition, ui, cwd);
  if (row.result) component.updateResult(row.result);
  component.setExpanded(row.expanded ?? false);
  return component.render(WIDTH);
}

const text = (body: string) => [{ type: "text" as const, text: body }];
const longOutput = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n");

const tools: Record<string, { base: ToolRenderers | undefined; args: Record<string, unknown> }> = {
  read: { base: createReadToolDefinition(cwd) as ToolRenderers, args: { path: "src/a.ts" } },
  "no renderers": { base: undefined, args: { query: "pi tool rows", limit: 5 } },
  "renderCall only": {
    base: { renderCall: (args, theme) => new Text(theme.fg("toolTitle", `custom ${(args as { query: string }).query}`), 0, 0) },
    args: { query: "pi tool rows" },
  },
};

const states: Record<string, Omit<Row, "args" | "outputPad">> = {
  pending: {},
  "pending, expanded": { expanded: true },
  "success, collapsed": { result: { content: text(longOutput), isError: false, durationMs: 1234 } },
  "success, expanded": { result: { content: text(longOutput), isError: false, durationMs: 1234 }, expanded: true },
  "error, collapsed": { result: { content: text(longOutput), isError: true, durationMs: 20 } },
  "error, expanded": { result: { content: text("boom"), isError: true, durationMs: 20 }, expanded: true },
};

for (const [toolName, { base, args }] of Object.entries(tools)) {
  for (const outputPad of [0, 1]) {
    test(`${toolName}, outputPad ${outputPad}: rows match pi's default shell`, () => {
      for (const [state, row] of Object.entries(states)) {
        const input = { ...row, args, outputPad };
        assert.deepEqual(render(toolName, wrapped(toolName, base), input), render(toolName, defaultShellRow(toolName, base), input), state);
      }
    });
  }
}

test("a collapsed successful call is one quiet line in pi's box", () => {
  const lines = render("read", wrapped("read", tools.read.base), {
    args: { path: "src/a.ts" },
    result: { content: text("x"), isError: false, durationMs: 1234 },
  });
  assert.deepEqual(lines.map((line) => stripVTControlCharacters(line).trim()), ["", "", "▸ read src/a.ts  ✓ 1.2s", ""]);
});

test("edit: collapsed rows get pi's box, expanded rows are pi's own edit rows", () => {
  // pi keeps tool renderers with `args: unknown`; a built-in tool definition types its args.
  const edit = createEditToolDefinition(cwd) as ToolRenderers;
  const args = { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] };
  const success: Result = {
    content: text("Successfully replaced 1 block(s) in src/a.ts."),
    details: { diff: "-1 a\n+1 b", firstChangedLine: 1 },
    isError: false,
    durationMs: 50,
  };
  const failure: Result = { content: text("Could not find the exact text in src/a.ts."), isError: true, durationMs: 50 };
  for (const outputPad of [0, 1]) {
    for (const row of [{ args, outputPad }, { args, outputPad, result: success }]) {
      assert.deepEqual(render("edit", wrapped("edit", edit), row), render("edit", defaultShellRow("edit", edit), row));
    }
    for (const row of [{ args, outputPad }, { args, outputPad, result: success }, { args, outputPad, result: failure }]) {
      const expanded = { ...row, expanded: true };
      assert.deepEqual(render("edit", wrapped("edit", edit), expanded), render("edit", edit, expanded));
    }
  }
});
