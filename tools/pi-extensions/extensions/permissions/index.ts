import { execFileSync } from "node:child_process";
import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configFile } from "../../src/config.ts";
import { isSubagentChild } from "../../src/subagent-child.ts";
import { classify } from "./classify.ts";
import { askUser } from "./prompt.ts";
import { decide, loadRules } from "./rules.ts";
import { parseShell } from "./shell/commands.ts";
import type { Location, Rule } from "./types.ts";

function rulesFile(): string {
  return process.env.PI_PERMISSIONS_FILE || configFile("permissions");
}

export default function (pi: ExtensionAPI) {
  const home = os.homedir();
  const roots = new Map<string, string | undefined>();
  let rules: Rule[] = [];
  let loadError: string | undefined;
  let notified = false;
  let queue: Promise<unknown> = Promise.resolve();

  function load() {
    const file = rulesFile();
    // config boundary: a broken rules file is reported, not thrown from the extension
    try {
      rules = loadRules(file, home);
      loadError = undefined;
    } catch (e) {
      rules = [];
      loadError = `Permission rules failed to load (${file}): ${(e as Error).message}`;
    }
  }

  function gitRoot(cwd: string): string | undefined {
    if (roots.has(cwd)) return roots.get(cwd);
    let root: string | undefined;
    // child process boundary: git fails outside a repo
    try {
      root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined;
    } catch {
      // not a git repo
    }
    roots.set(cwd, root);
    return root;
  }

  /** One dialog at a time: codemode scripts can make parallel nested calls. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  load();

  pi.on("session_start", (_event, ctx) => {
    load();
    notified = false;
    if (loadError && ctx.hasUI) {
      ctx.ui.notify(loadError, "error");
      notified = true;
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (loadError) {
      if (ctx.hasUI && !notified) {
        notified = true;
        ctx.ui.notify(loadError, "error");
      }
      return { block: true, reason: loadError };
    }
    const loc: Location = { cwd: ctx.cwd, root: gitRoot(ctx.cwd), home };
    const decision = decide(classify(event.toolName, event.input, loc, parseShell), rules, event.input);
    if (decision.effect === "allow") return undefined;

    const action = decision.check?.action ?? event.toolName;
    const resource = decision.resource ?? "*";
    if (decision.effect === "deny") {
      const why = decision.rule?.reason;
      const via = decision.check?.denyOnly ? " (path named in a shell command)" : "";
      return { block: true, reason: `Blocked by permission rule: ${action} ${resource}${via}${why ? ": " + why : ""}` };
    }
    if (isSubagentChild()) {
      return { block: true, reason: `Permission rule ${action} ${resource} needs user approval, which a subagent cannot ask for` };
    }
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Permission rule ${action} ${resource} needs approval and no one is present to give it`,
      };
    }
    const answer = await enqueue(() =>
      askUser(ctx.ui, { toolName: event.toolName, action, resource, rule: decision.rule, input: event.input }),
    );
    if (answer.allow) return undefined;
    return { block: true, reason: answer.reason ? `Denied by the user: ${answer.reason}` : "Denied by the user" };
  });
}
