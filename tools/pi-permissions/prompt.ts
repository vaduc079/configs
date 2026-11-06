import type { Rule } from "./types.ts";

export interface AskRequest {
  toolName: string;
  action: string;
  resource: string;
  rule?: Rule;
  input: unknown;
}

/** The slice of pi's `ctx.ui` that the dialog needs. */
export interface PromptUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

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
  const text = typeof command === "string" ? command : (JSON.stringify(targetFirst(input), null, 2) ?? String(input));
  return text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW) + "\n… (truncated)" : text;
}

/** A dismissed dialog counts as Deny. */
export async function askUser(ui: PromptUi, request: AskRequest): Promise<{ allow: boolean; reason?: string }> {
  const title = `${request.toolName} — ask: ${request.action} ${request.resource}\n\n${preview(request.toolName, request.input)}`;
  const choice = await ui.select(title, [ALLOW, DENY, DENY_WITH_REASON]);
  if (choice === ALLOW) return { allow: true };
  if (choice === DENY_WITH_REASON) {
    const reason = (await ui.input("Reason for denying (sent to the model):"))?.trim();
    return reason ? { allow: false, reason } : { allow: false };
  }
  return { allow: false };
}
