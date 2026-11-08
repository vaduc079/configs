import { ExtensionSelectorComponent, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Rule } from "./types.ts";

export interface AskRequest {
  toolName: string;
  action: string;
  resource: string;
  rule?: Rule;
  input: unknown;
}

/** The slice of pi's `ctx.ui` that the dialog needs. */
export type PromptUi = Pick<
  ExtensionUIContext,
  "input" | "custom" | "getToolsExpanded" | "setToolsExpanded" | "getEditorText" | "setEditorText"
>;

const MAX_PREVIEW = 1500;
const ALLOW = "Allow";
const DENY = "Deny";
const DENY_WITH_REASON = "Deny with reason";

const TARGET_KEYS = ["channel_id", "channel", "thread_ts", "page_id", "pageId", "issueIdOrKey", "cloudId"];

/** Target keys first, then the rest in original order, so a long field cannot push the target past the cut. */
function targetFirst(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  const first = TARGET_KEYS.filter((k) => k in obj);
  return Object.fromEntries([...first, ...Object.keys(obj).filter((k) => !first.includes(k))].map((k) => [k, obj[k]]));
}

function preview(toolName: string, input: unknown): string {
  const command =
    toolName === "bash" && input !== null && typeof input === "object"
      ? (input as Record<string, unknown>).command
      : undefined;
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- JSON.stringify returns undefined for undefined, a function or a symbol, despite its declared type
  const text = typeof command === "string" ? command : (JSON.stringify(targetFirst(input), null, 2) ?? String(input));
  return text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW) + "\n… (truncated)" : text;
}

/** A dismissed dialog counts as Deny. */
export async function askUser(
  ui: PromptUi,
  request: AskRequest,
): Promise<{ allow: boolean; reason?: string }> {
  // What will run comes first; the rule that asked comes last, so the two are not confused.
  const question = request.toolName === "bash" ? "Run bash command?" : `Allow ${request.toolName}?`;
  const body = preview(request.toolName, request.input).replace(/^/gm, "  ");
  const rule = request.rule ? `${request.rule.action} ${request.rule.resource}` : `${request.action} ${request.resource}`;
  const title = `${question}\n\n${body}\n\nRule: ask · ${rule}`;
  const options = [ALLOW, DENY, DENY_WITH_REASON];
  // pi's `select` reports a question; the same selector shown through `custom` can say permission.
  // pi 1.5.0 restores the user's draft after a custom dialog with `setText`, which drops the text of large
  // pastes and keeps only their `[paste #1 …]` markers; put the expanded draft back.
  const draft = ui.getEditorText();
  const choice = await ui.custom<string | undefined>(
    (_tui, _theme, _keybindings, done) =>
      new ExtensionSelectorComponent(title, options, done, () => done(undefined), {
        onToggleToolsExpanded: () => ui.setToolsExpanded(!ui.getToolsExpanded()),
      }),
    { blocked: { kind: "permission", message: title } },
  );
  if (ui.getEditorText() !== draft) ui.setEditorText(draft);
  if (choice === ALLOW) return { allow: true };
  if (choice === DENY_WITH_REASON) {
    const reason = (await ui.input("Reason for denying (sent to the model):"))?.trim();
    return reason ? { allow: false, reason } : { allow: false };
  }
  return { allow: false };
}
