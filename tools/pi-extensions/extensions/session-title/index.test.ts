import assert from "node:assert/strict";
import { setTimeout as tick } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sessionTitle from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

test("a vague session is retitled even when its run settles before the first title arrives", async () => {
  const handlers = new Map<string, Handler>();
  let name: string | undefined;
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    getSessionName: () => name,
    setSessionName: (value: string) => (name = value),
  } as unknown as ExtensionAPI;
  sessionTitle(pi);

  const replies: ((text: string) => void)[] = [];
  const ctx = {
    modelRegistry: {
      find: () => ({}),
      complete: () =>
        new Promise((resolve) =>
          replies.push((text) => resolve({ stopReason: "stop", content: [{ type: "text", text }] })),
        ),
    },
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Kafka lag" }] } },
      ],
    },
    ui: { setTitle: () => {} },
  };
  const emit = (event: string, payload: unknown) => handlers.get(event)?.(payload, ctx);

  await emit("before_agent_start", { messageType: "user", prompt: "read note.txt" });
  await emit("agent_settled", { aborted: false });
  replies[0]?.("Note summary\nvague");
  await tick();
  assert.equal(name, "Note summary");

  replies[1]?.("Kafka consumer lag");
  await tick();
  assert.equal(name, "Kafka consumer lag");
});
