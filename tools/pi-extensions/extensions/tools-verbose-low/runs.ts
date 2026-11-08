import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface Run {
  /** Tool call IDs in call order; ids[0] is the leader. */
  ids: string[];
  /** A break or agent_end happened after the last call. */
  closed: boolean;
  /** The header was clicked open. */
  expanded: boolean;
}

/**
 * Assigns tool call IDs to runs from the message stream, live or replayed.
 * Every mutating method returns the runs it changed, so the caller can redraw
 * their rows.
 */
export function createRunTracker() {
  let byId = new Map<string, Run>();
  let open: Run | undefined;
  let cursor = 0; // next block of the streaming assistant message

  function reset() {
    byId = new Map();
    open = undefined;
    cursor = 0;
  }

  function closeOpen(): Run[] {
    if (!open) return [];
    const run = open;
    run.closed = true;
    open = undefined;
    return [run];
  }

  function addCall(id: string): Run[] {
    if (!open) open = { ids: [], closed: false, expanded: false };
    open.ids.push(id);
    byId.set(id, open);
    return [open];
  }

  function fail(id: string): Run[] {
    const run = byId.get(id);
    if (!run) return [];
    byId.delete(id);
    const at = run.ids.indexOf(id);
    const after = run.ids.slice(at + 1);
    const wasOpen = run === open;

    // The failure ends the run: what came before it is closed.
    run.ids = run.ids.slice(0, at);
    run.closed = true;
    if (wasOpen) open = undefined;

    const changed = run.ids.length > 0 ? [run] : [];
    if (after.length === 0) return changed;
    const tail: Run = { ids: after, closed: !wasOpen, expanded: run.expanded };
    for (const afterId of after) byId.set(afterId, tail);
    if (wasOpen) open = tail;
    return [...changed, tail];
  }

  function walk(message: Extract<AgentMessage, { role: "assistant" }>, final: boolean): Run[] {
    const changed: Run[] = [];
    while (cursor < message.content.length) {
      const block = message.content[cursor];
      if (block.type === "text") {
        const isEmpty = block.text.trim() === "";
        if (isEmpty && !final && cursor === message.content.length - 1) break;
        if (!isEmpty) changed.push(...closeOpen());
      } else if (block.type === "toolCall") {
        changed.push(...addCall(block.id));
      }
      cursor++;
    }
    return changed;
  }

  function applyMessage(message: AgentMessage): Run[] {
    switch (message.role) {
      case "toolResult":
        return message.isError ? fail(message.toolCallId) : [];
      case "custom":
        return message.display ? closeOpen() : [];
      case "user":
      case "bashExecution":
      case "compactionSummary":
      case "branchSummary":
        return closeOpen();
      default:
        return [];
    }
  }

  function messageStart(message: AgentMessage) {
    if (message.role === "assistant") cursor = 0;
  }

  function messageEnd(message: AgentMessage): Run[] {
    if (message.role !== "assistant") return applyMessage(message);
    const changed = walk(message, true);
    // pi shows an aborted or failed response as errors on its tool rows (it writes no results for them),
    // or as an error line when it has none; either way the run ends there.
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      for (const block of message.content) if (block.type === "toolCall") changed.push(...fail(block.id));
      changed.push(...closeOpen());
    }
    return changed;
  }

  return {
    /** message_start. */
    messageStart,
    /** message_update. The same message arrives many times with growing content. */
    messageUpdate: (message: AgentMessage): Run[] =>
      message.role === "assistant" ? walk(message, false) : [],
    /** message_end. Every block is final. */
    messageEnd,
    closeOpen,
    /** Rebuild from buildContextEntries(), what pi draws, then close the open run. */
    replay(entries: SessionEntry[]) {
      reset();
      for (const entry of entries) {
        if (entry.type === "message") {
          messageStart(entry.message);
          messageEnd(entry.message);
        } else if (entry.type === "compaction" || entry.type === "branch_summary") {
          closeOpen();
        } else if (entry.type === "custom_message" && entry.display) {
          closeOpen();
        }
      }
      closeOpen();
    },
    /** The run holding this call, or undefined if unknown or failed. */
    runOf: (id: string) => byId.get(id),
  };
}

export type RunTracker = ReturnType<typeof createRunTracker>;
