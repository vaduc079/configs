/**
 * One `pi --mode rpc` child process: JSON-lines framing, commands with responses, events, and
 * extension dialogs. Knows nothing about subagents. Protocol: pi docs rpc.md, rpc-commands.md,
 * rpc-extension-ui.md.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

export type RpcEvent = { type: string; [key: string]: unknown };
export type RpcCommand = { type: string; [key: string]: unknown };
export type RpcResponse = {
  type: "response";
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: { disposition?: "started" | "queued" | "handled" };
};

export type UiRequest = {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: "info" | "warning" | "error";
};
export type UiAnswer = { value: string } | { confirmed: boolean } | { cancelled: true };

type ExitInfo = { code: number | null; signal: string | null; stderrTail: string };

export type RpcProcessOptions = {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  onEvent(event: RpcEvent): void;
  /**
   * Dialog methods need the returned answer; for fire-and-forget methods it is ignored.
   * `signal` aborts when this process closes or exits, since its answer can no longer be delivered.
   */
  onUiRequest(request: UiRequest, signal: AbortSignal): Promise<UiAnswer>;
  onExit(info: ExitInfo): void;
};

/** The parts of RpcProcess that Subagent uses, so tests can pass a fake. */
export type RpcConnection = {
  send(command: RpcCommand): Promise<RpcResponse>;
  close(): void;
};

/** Extension UI methods that block the child until it gets an answer (rpc-extension-ui.md). */
export const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const STDERR_KEEP = 4_000;
const KILL_AFTER_MS = 5_000;

export class RpcProcess implements RpcConnection {
  private readonly proc: ChildProcess;
  private readonly options: RpcProcessOptions;
  private readonly pending = new Map<string, (response: RpcResponse) => void>();
  /** Aborted on close() or exit: nothing more is written to stdin, and open dialogs close. */
  private readonly closing = new AbortController();
  private stderr = "";
  private exited = false;

  constructor(options: RpcProcessOptions) {
    this.options = options;
    const invocation = piInvocation(["--mode", "rpc", ...options.args]);
    this.proc = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const reader = new JsonLineReader(
      (record) => this.guard(() => this.handleRecord(record)),
      (line) => this.keepStderr(`non-JSON stdout: ${line}\n`),
    );
    // setEncoding keeps a multibyte character that straddles two chunks intact.
    this.proc.stdout?.setEncoding("utf8").on("data", (data: string) => reader.push(data));
    this.proc.stderr?.setEncoding("utf8").on("data", (data: string) => this.keepStderr(data));
    // "close" rather than "exit": it fires after stdio is drained, so the crash's last stderr lines are kept.
    this.proc.on("close", (code, signal) => this.finish(code, signal));
    // Spawn failures emit "error" and may never emit "close". An unhandled "error" event would crash the parent pi.
    this.proc.on("error", (error) => {
      this.keepStderr(String(error));
      this.finish(null, null);
    });
    // Writing to a child that just died fails with EPIPE; the exit handler already reports it.
    this.proc.stdin?.on("error", () => {});
  }

  send(command: RpcCommand): Promise<RpcResponse> {
    if (this.closing.signal.aborted) return Promise.resolve({ type: "response", command: command.type, success: false, error: "process closed" });
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.write({ ...command, id });
    });
  }

  /** Closing stdin asks pi to shut down cleanly; kill it if it is still running after 5 s. */
  close() {
    if (this.closing.signal.aborted) return;
    this.closing.abort();
    this.proc.stdin?.end();
    setTimeout(() => this.exited || this.proc.kill("SIGTERM"), KILL_AFTER_MS).unref();
  }

  private finish(code: number | null, signal: string | null) {
    if (this.exited) return;
    this.exited = true;
    this.closing.abort();
    for (const resolve of this.pending.values())
      resolve({ type: "response", command: "", success: false, error: `process exited (${code ?? signal})` });
    this.pending.clear();
    const stderrTail = this.stderr.trim().split("\n").slice(-20).join("\n");
    this.guard(() => this.options.onExit({ code, signal, stderrTail }));
  }

  /**
   * Callbacks run inside stream and process event handlers, where a throw (for example a full disk while
   * saving a result) would be uncaught and exit the parent pi. Keep the error with this child's stderr instead.
   */
  private guard(callback: () => void) {
    try {
      callback();
    } catch (error) {
      this.keepStderr(`subagent callback failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
  }

  private handleRecord(record: RpcEvent) {
    if (record.type === "response") {
      const id = record.id as string | undefined;
      const resolve = id ? this.pending.get(id) : undefined;
      if (!id || !resolve) return;
      this.pending.delete(id);
      resolve(record as unknown as RpcResponse);
      return;
    }
    if (record.type !== "extension_ui_request") {
      this.options.onEvent(record);
      return;
    }
    const request = record as unknown as UiRequest;
    const answer = this.options.onUiRequest(request, this.closing.signal);
    if (!DIALOG_METHODS.has(request.method)) return;
    // The child blocks until it gets an answer, so a failed dialog still answers "cancelled".
    const cancelled: UiAnswer = { cancelled: true };
    void answer
      .catch(() => cancelled)
      .then((reply) => this.write({ type: "extension_ui_response", id: request.id, ...reply }));
  }

  private keepStderr(text: string) {
    this.stderr = (this.stderr + text).slice(-STDERR_KEEP);
  }

  private write(record: Record<string, unknown>) {
    if (!this.closing.signal.aborted) this.proc.stdin?.write(`${JSON.stringify(record)}\n`);
  }
}

/**
 * Splits a stream into JSON records on LF only. JSON strings may contain U+2028/U+2029, which
 * node:readline would also treat as line ends (rpc.md "Framing"). A line that is not JSON goes
 * to onInvalid instead of throwing inside the stream handler.
 */
export class JsonLineReader {
  private buffer = "";
  private readonly onRecord: (record: RpcEvent) => void;
  private readonly onInvalid: (line: string) => void;

  constructor(onRecord: (record: RpcEvent) => void, onInvalid: (line: string) => void) {
    this.onRecord = onRecord;
    this.onInvalid = onInvalid;
  }

  push(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!text.trim()) continue;
      const record = parseRecord(text);
      if (record) this.onRecord(record);
      else this.onInvalid(text);
    }
  }
}

function parseRecord(text: string): RpcEvent | undefined {
  try {
    const value: unknown = JSON.parse(text);
    const isRecord = typeof value === "object" && value !== null && typeof (value as RpcEvent).type === "string";
    return isRecord ? (value as RpcEvent) : undefined;
  } catch {
    return undefined;
  }
}

/** Same lookup as pi's subagent example: rerun the current pi entry point with the same runtime. */
export function piInvocation(args: string[]) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/root/") && fs.existsSync(script))
    return { command: process.execPath, args: [script, ...args] };
  return { command: "pi", args };
}
