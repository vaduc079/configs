// Capping long text before it goes into the conversation, like OpenCode's tool output
// (packages/core/src/tool-output.ts).
import fs from "node:fs";
import path from "node:path";

const MAX_LINES = 2_000;
const MAX_BYTES = 50 * 1024;

/**
 * `text` unchanged when it fits in 2,000 lines and 50 KB. Otherwise the leading lines that fit plus a note, with the
 * full text saved to `fullOutputPath`.
 */
export function capText(text: string, fullOutputPath: string): { text: string; fullOutputPath?: string } {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return { text };
  let bytes = 0;
  const kept = lines.slice(0, MAX_LINES).filter((line) => {
    bytes += Buffer.byteLength(line) + 1;
    return bytes <= MAX_BYTES;
  });
  fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
  fs.writeFileSync(fullOutputPath, text);
  return {
    text: `${kept.join("\n")}\n[showing lines 1-${kept.length} of ${lines.length}; full output saved to ${fullOutputPath}]`,
    fullOutputPath,
  };
}
