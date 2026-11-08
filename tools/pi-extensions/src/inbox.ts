// Posting messages to the agent from background work (a subagent result, a finished background command).
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Posts one message; `triggerTurn` says whether it may start a turn. */
export type Post = (triggerTurn: boolean) => void;

/**
 * Delivers posts without pi's follow-up queue, which Esc empties. While the agent is busy, posts wait here and go
 * out when it settles: after a normal finish the last one starts a turn; after Esc none does, so they show in the
 * chat and wait for the user's next message. Compaction and /tree summaries also hold posts (the agent is not idle)
 * but end without `agent_settled`, so those flush once the agent is idle.
 *
 * Call once when the extension loads. `label` names the message in the error shown when a post fails.
 */
export function registerInbox(pi: ExtensionAPI, label: string) {
  let held: Post[] = [];
  let session: ExtensionContext | undefined;

  /** Taken one at a time, so if one post throws, the rest stay held for the next flush. */
  const flush = (startTurn: boolean) => {
    for (let post = held.shift(); post; post = held.shift()) post(startTurn && held.length === 0);
  };

  pi.on("session_start", async (_event, ctx) => {
    session = ctx;
    held = [];
  });
  pi.on("session_shutdown", async () => {
    session = undefined;
    held = [];
  });
  pi.on("agent_settled", async (event) => flush(!event.aborted));

  // pi clears its compaction state only after session_compact and session_tree handlers return, so check on the
  // next tick. A throw there would be uncaught and exit pi; a failed post leaves the rest held for the next flush.
  const flushAfterCompaction = async (_event: unknown, ctx: ExtensionContext) => {
    setTimeout(() => {
      try {
        if (ctx.isIdle()) flush(true);
      } catch (error) {
        ctx.ui.notify(`${label} not posted: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }, 0);
  };
  pi.on("session_compact", flushAfterCompaction);
  pi.on("session_compact_failed", flushAfterCompaction);
  pi.on("session_tree", flushAfterCompaction);

  return {
    deliver(post: Post) {
      if (session && !session.isIdle()) held.push(post);
      else post(true);
    },
  };
}
