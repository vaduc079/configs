import { createHash } from "node:crypto";

export function osc7577(token: string, pid: number, time: number, pairs: string): string {
  const body = `pid=${pid}:time=${time}:${pairs}`;
  const mac = createHash("sha256").update(`${body}:${token}`).digest("hex");
  return `\x1b]7577;${body}:mac=${mac}\x1b\\`;
}

export function resumePairs(argv: string[], cwd: string): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  return `argv=${argv.map(b64).join(",")}:cwd=${b64(cwd)}`;
}
