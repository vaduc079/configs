// Stands in for `pi --mode rpc` in rpc.test.ts: asks one dialog, then echoes each record it receives as an
// `echo` event. With --exit-after-ask it exits right after asking, as a crashed child would.
import * as readline from "node:readline";

const send = (record: unknown) => process.stdout.write(`${JSON.stringify(record)}\n`);
send({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Allow?" });
if (process.argv.includes("--exit-after-ask")) process.exit(3);
readline.createInterface({ input: process.stdin }).on("line", (line) => send({ type: "echo", record: JSON.parse(line) as unknown }));
