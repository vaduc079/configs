import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JsonLineReader, type RpcEvent, RpcProcess, type RpcProcessOptions } from "../rpc.ts";

function read(chunks: string[]) {
  const records: RpcEvent[] = [];
  const invalid: string[] = [];
  const reader = new JsonLineReader(
    (record) => records.push(record),
    (line) => invalid.push(line),
  );
  for (const chunk of chunks) reader.push(chunk);
  return { records, invalid };
}

test("a record split across chunks is read once it is complete", () => {
  const { records } = read(['{"type":"agent', '_start"}\n{"type":', '"agent_settled"}\n']);
  assert.deepEqual(records, [{ type: "agent_start" }, { type: "agent_settled" }]);
});

test("U+2028 and U+2029 inside a JSON string do not split the record", () => {
  const { records } = read([`${JSON.stringify({ type: "message_end", text: "line\u2028separator\u2029paragraph" })}\n`]);
  assert.deepEqual(records, [{ type: "message_end", text: "line\u2028separator\u2029paragraph" }]);
});

test("CRLF line ends and blank lines are tolerated", () => {
  const { records } = read(['{"type":"a"}\r\n\n{"type":"b"}\n']);
  assert.deepEqual(records, [{ type: "a" }, { type: "b" }]);
});

test("a line that is not a JSON record is set aside instead of throwing", () => {
  const { records, invalid } = read(['debug: hello\n{"type":"a"}\n[1,2]\n']);
  assert.deepEqual(records, [{ type: "a" }]);
  assert.deepEqual(invalid, ["debug: hello", "[1,2]"]);
});

/**
 * Runs RpcProcess against test/fake-pi.mjs. RpcProcess starts pi as `node <process.argv[1]> --mode rpc …`,
 * so pointing argv[1] at the fake swaps the child without a test seam in the code.
 */
function startFake(args: string[], onUiRequest: RpcProcessOptions["onUiRequest"]) {
  const events: RpcEvent[] = [];
  let exited: () => void = () => {};
  const exit = new Promise<void>((resolve) => (exited = resolve));
  const script = process.argv[1];
  process.argv[1] = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));
  const rpc = new RpcProcess({ args, cwd: process.cwd(), env: {}, onEvent: (event) => events.push(event), onUiRequest, onExit: () => exited() });
  process.argv[1] = script;
  return { rpc, events, exit };
}

/** Waits for `check`, failing after 2 s instead of hanging the test run. */
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the fake child");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("a dialog answer is written back to the child that asked", async (t) => {
  let signal: AbortSignal | undefined;
  const { rpc, events } = startFake([], async (_request, asking) => {
    signal = asking;
    return { confirmed: true };
  });
  t.after(() => rpc.close());
  await until(() => events.length > 0);
  assert.deepEqual(events[0].record, { type: "extension_ui_response", id: "d1", confirmed: true });
  assert.equal(signal?.aborted, false);
});

test("closing the process aborts the signal of its open dialog", async (t) => {
  let signal: AbortSignal | undefined;
  const { rpc, exit } = startFake([], (_request, asking) => {
    signal = asking;
    return new Promise(() => {});
  });
  t.after(() => rpc.close());
  await until(() => signal !== undefined);
  rpc.close();
  assert.equal(signal?.aborted, true);
  await exit;
});

test("a child that exits aborts the signal of its open dialog", async (t) => {
  let signal: AbortSignal | undefined;
  const { rpc, exit } = startFake(["--exit-after-ask"], (_request, asking) => {
    signal = asking;
    return new Promise(() => {});
  });
  t.after(() => rpc.close());
  await exit;
  assert.equal(signal?.aborted, true);
});
