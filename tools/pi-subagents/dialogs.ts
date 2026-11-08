/** Shows children's extension dialogs (for example permission prompts) in the parent, one at a time. */
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { DIALOG_METHODS, type UiAnswer, type UiRequest } from "./rpc.ts";

export type DialogUi = Pick<ExtensionUIContext, "select" | "confirm" | "input" | "editor" | "notify">;

const CANCELLED: UiAnswer = { cancelled: true };

export class DialogForwarder {
  private readonly ui: DialogUi;
  private readonly hasUI: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  /** Children exit after session shutdown; their dialogs must not touch the old context. */
  private disposed = false;

  constructor(ui: DialogUi, hasUI: boolean) {
    this.ui = ui;
    this.hasUI = hasUI;
  }

  /** `signal` aborts once the child process that asked has stopped; an open dialog then closes. */
  forward(label: string, request: UiRequest, signal: AbortSignal): Promise<UiAnswer> {
    if (this.disposed) return Promise.resolve(CANCELLED);
    const prefix = `[subagent "${label}"] `;
    if (request.method === "notify") {
      this.ui.notify(prefix + (request.message ?? ""), request.notifyType);
      return Promise.resolve(CANCELLED);
    }
    // Status, widget, and title calls come from the child's own UI extensions; they do not apply here.
    if (!DIALOG_METHODS.has(request.method) || !this.hasUI) return Promise.resolve(CANCELLED);

    const receivedAt = Date.now();
    const answer = this.queue.then(() => {
      // While this dialog waited behind others, the process that asked may have stopped, or its own
      // timeout (counted from when it asked) may have run out and picked the default answer.
      const remaining = request.timeout === undefined ? undefined : request.timeout - (Date.now() - receivedAt);
      const stale = this.disposed || signal.aborted || (remaining !== undefined && remaining <= 0);
      if (stale) return CANCELLED;
      return this.show(prefix + (request.title ?? ""), request, { timeout: remaining, signal });
    });
    // A failed dialog must not block the ones queued after it.
    this.queue = answer.catch(() => undefined);
    return answer;
  }

  dispose() {
    this.disposed = true;
  }

  private async show(title: string, request: UiRequest, options: { timeout?: number; signal: AbortSignal }): Promise<UiAnswer> {
    // `editor` takes no options, so an open editor stays until answered.
    if (request.method === "confirm") return { confirmed: await this.ui.confirm(title, request.message ?? "", options) };
    const value =
      request.method === "select"
        ? await this.ui.select(title, request.options ?? [], options)
        : request.method === "input"
          ? await this.ui.input(title, request.placeholder, options)
          : await this.ui.editor(title, request.prefill);
    return value === undefined ? CANCELLED : { value };
  }
}
