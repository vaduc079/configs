// Posting messages to the agent from background work, such as a finished background command.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type InboxMessage = Parameters<ExtensionAPI["sendMessage"]>[0];

type Post = { message: InboxMessage; onPosted?: () => void; startTurn: boolean };

type DeliverOptions = {
  /** Runs once the post is in the conversation, or handed to pi when no run is active. */
  onPosted?: () => void;
  /** Whether the post may start a turn when the agent is idle (default true). A steered post joins the run either way. */
  startTurn?: boolean;
};

/**
 * While the agent is busy outside a run (compaction, /tree summaries, a run still starting), posts wait here. They are
 * steered in when a run starts, and otherwise go out when the agent settles, or on the next tick after a compaction or
 * /tree if the agent is idle by then (those end without `agent_settled`).
 *
 * Esc empties pi's steering queue before aborting, so steered posts not yet in the conversation are posted again
 * without starting a turn: they show in the chat and wait for the user's next message. A manual /compact or /tree also
 * aborts the run but keeps the queue, so posts are not posted again after one starts, even if it fails at once. A run
 * that ends normally has drained everything pi kept, so a steered post that has not arrived by then (the user dequeued
 * it, or pressed Esc before a /compact) is posted again.
 *
 * Call once when the extension loads. `label` names the message in the error shown when a post fails.
 */
export function registerInbox(pi: ExtensionAPI, label: string) {
  let held: Post[] = [];
  let steered: Post[] = [];
  // Set when a compaction or /tree ran since the last settle: pi kept its queue, so steered posts must not be posted again.
  let queueKept = false;
  let session: ExtensionContext | undefined;

  const steer = (post: Post) => {
    steered.push(post);
    pi.sendMessage(post.message, { deliverAs: "steer" });
  };

  /**
   * Taken one at a time, so if one post throws, the rest stay held for the next flush. The last post starts one turn
   * for the batch, if the flush allows it and a post in the batch asked for one.
   */
  const flush = (startTurn: boolean) => {
    const batchWantsTurn = startTurn && held.some((post) => post.startTurn);
    for (let post = held.shift(); post; post = held.shift()) {
      pi.sendMessage(post.message, { triggerTurn: batchWantsTurn && held.length === 0 });
      post.onPosted?.();
    }
  };

  // A throw in a timer would be uncaught and exit pi; a failed post leaves the rest held for the next flush.
  const onNextTick = (ctx: ExtensionContext, run: () => void) => {
    setTimeout(() => {
      try {
        run();
      } catch (error) {
        ctx.ui.notify(`${label} not posted: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }, 0);
  };

  pi.on("session_start", async (_event, ctx) => {
    session = ctx;
    held = [];
    steered = [];
  });
  pi.on("session_shutdown", async () => {
    session = undefined;
    held = [];
    steered = [];
  });
  pi.on("agent_start", async () => {
    for (let post = held.shift(); post; post = held.shift()) steer(post);
  });
  pi.on("message_end", async (event) => {
    const message = event.message;
    if (message.role !== "custom") return;
    const index = steered.findIndex((post) => post.message.customType === message.customType && post.message.content === message.content);
    if (index === -1) return;
    const [post] = steered.splice(index, 1);
    post.onPosted?.();
  });
  pi.on("agent_settled", async (event, ctx) => {
    queueKept = false;
    const repost = (startTurn: boolean) => {
      held.unshift(...steered);
      steered = [];
      flush(startTurn);
    };
    if (!event.aborted) {
      repost(true);
      return;
    }
    // A /compact that aborted the run has started compacting, or already failed, by the next tick.
    onNextTick(ctx, () => {
      if (ctx.isIdle() && !queueKept) repost(false);
    });
  });

  // pi clears its compaction state only after session_compact and session_tree handlers return, so check on the
  // next tick.
  const flushAfterCompaction = async (_event: unknown, ctx: ExtensionContext) => {
    queueKept = true;
    onNextTick(ctx, () => {
      if (ctx.isIdle()) flush(true);
    });
  };
  pi.on("session_compact", flushAfterCompaction);
  pi.on("session_compact_failed", flushAfterCompaction);
  pi.on("session_tree", flushAfterCompaction);

  return {
    deliver(message: InboxMessage, { onPosted, startTurn = true }: DeliverOptions = {}) {
      const post = { message, onPosted, startTurn };
      if (!session || session.isIdle()) {
        pi.sendMessage(message, { triggerTurn: startTurn });
        onPosted?.();
      }
      // `signal` is set only while an agent run is active, which is when pi accepts a steer. Once aborted (Esc already
      // emptied the queue), a steer would sit in the queue and also be posted again after the abort.
      else if (session.signal && !session.signal.aborted) steer(post);
      else held.push(post);
    },
  };
}
