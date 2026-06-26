#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname as pathDirname, join } from "node:path";

const herdr = process.env.HERDR_BIN_PATH || "herdr";
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR || "/tmp/herdr-agent-topic-sync";
const statePath = join(stateDir, "selected-agents.json");

const GENERATED_AGENT_PATTERN = /^(codex|claude|opencode|gemini|cursor|agent)\s*:\s+/i;

function run(args, options = {}) {
  const result = spawnSync(herdr, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (options.allowFailure) return "";
    throw new Error(`${herdr} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function json(args, options = {}) {
  const output = run(args, options);
  return output ? JSON.parse(output) : null;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTopic(value) {
  return cleanText(value)
    .replace(/^<command-name>.*?<\/command-name>\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/^>\s*/, "")
    .replace(/^\u203a\s*/, "")
    .trim();
}

function homePath(...parts) {
  const home = process.env.HOME;
  return home ? join(home, ...parts) : "";
}

function codexHomePath(...parts) {
  const codexHome = process.env.CODEX_HOME || homePath(".codex");
  return codexHome ? join(codexHome, ...parts) : "";
}

function findFirst(args) {
  const result = spawnSync("find", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return "";
  return result.stdout.split("\n").find(Boolean) || "";
}

function readLines(path) {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}

function parseJson(line) {
  try {
    return line.trim() ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

function usableTopic(topic) {
  const text = cleanText(topic);
  if (!text || text.length < 2) return false;
  if (text.startsWith("/clear")) return false;
  if (text.startsWith("<local-command")) return false;
  if (GENERATED_AGENT_PATTERN.test(text)) return false;
  return true;
}

function codexSessionTopic(id) {
  const root = codexHomePath("sessions");
  if (!root || !existsSync(root)) return "";

  const path = findFirst([root, "-type", "f", "-name", `*${id}.jsonl`]);
  if (!path) return "";

  for (const line of readLines(path)) {
    const entry = parseJson(line);
    if (entry?.type !== "event_msg") continue;

    const payload = entry.payload;
    if (payload?.type !== "user_message") continue;

    const topic = compactTopic(payload.message);
    if (usableTopic(topic)) return topic;
  }

  return "";
}

function claudeSessionTopic(id) {
  const root = homePath(".claude", "projects");
  if (!root || !existsSync(root)) return "";

  const path = findFirst([root, "-type", "f", "-name", `${id}.jsonl`]);
  if (!path) return "";

  const generatedTitle = claudeGeneratedTitle(path);
  if (generatedTitle) return generatedTitle;

  for (const line of readLines(path)) {
    const entry = parseJson(line);
    if (entry?.type !== "user" || entry.isMeta) continue;

    const content = entry.message?.content;
    const text = Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : part?.text)).filter(Boolean).join(" ")
      : content;
    const topic = compactTopic(text);
    if (usableTopic(topic)) return topic;
  }

  return "";
}

function claudeGeneratedTitle(path) {
  let latestTitle = "";

  for (const line of readLines(path)) {
    const entry = parseJson(line);
    if (entry?.type !== "ai-title") continue;

    const title = compactTopic(entry.aiTitle);
    if (usableTopic(title)) latestTitle = title;
  }

  return latestTitle;
}

function sessionTopic(pane) {
  const session = pane?.agent_session;
  const agent = cleanText(session?.agent || pane?.agent).toLowerCase();
  const id = cleanText(session?.value);

  if (!agent || !id) return "";
  if (agent === "codex") return codexSessionTopic(id);
  if (agent === "claude") return claudeSessionTopic(id);
  return "";
}

function topicFromPane(pane) {
  const candidates = [
    pane?.title,
    pane?.custom_status,
    sessionTopic(pane),
  ];

  for (const candidate of candidates) {
    const topic = compactTopic(candidate);
    if (usableTopic(topic)) return topic;
  }

  return "";
}

function workspaceLabel(topic) {
  return cleanText(topic);
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  mkdirSync(pathDirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function workspaceSelections(state) {
  if (!state.workspaces || typeof state.workspaces !== "object") {
    state.workspaces = {};
  }

  return state.workspaces;
}

function pruneClosedWorkspaces(state, workspaces) {
  const liveWorkspaceIds = new Set(workspaces.map((workspace) => workspace.workspace_id).filter(Boolean));
  const selections = workspaceSelections(state);

  for (const workspaceId of Object.keys(selections)) {
    if (!liveWorkspaceIds.has(workspaceId)) delete selections[workspaceId];
  }
}

function agentKey(agent) {
  return cleanText(agent?.pane_id || agent?.agent_session?.value);
}

function agentsByWorkspace(agents) {
  const groupedAgents = new Map();

  for (const agent of agents) {
    const workspaceId = agent?.workspace_id;
    if (!workspaceId) continue;

    const workspaceAgents = groupedAgents.get(workspaceId) || [];
    workspaceAgents.push(agent);
    groupedAgents.set(workspaceId, workspaceAgents);
  }

  return groupedAgents;
}

function trackedAgent(agent) {
  if (!agent) return null;
  return { agent, topic: topicFromPane(agent) };
}

function findSelectedAgent(workspaceId, agents, selections) {
  const previousSelection = selections?.[workspaceId];
  const previousAgentKey = cleanText(previousSelection?.agentKey);

  if (previousAgentKey) {
    const existingAgent = agents.find((agent) => agentKey(agent) === previousAgentKey);
    if (existingAgent) return trackedAgent(existingAgent);
  }

  return trackedAgent(agents[0]);
}

function rememberSelectedAgent(workspaceId, selectedAgent, selections) {
  selections[workspaceId] = {
    agentKey: agentKey(selectedAgent.agent),
    paneId: selectedAgent.agent?.pane_id,
    session: selectedAgent.agent?.agent_session,
    selectedAt: new Date().toISOString(),
  };
}

function selectedAgentForWorkspace(workspace, agents, state) {
  const workspaceId = workspace?.workspace_id;
  if (!workspaceId) return null;

  const selections = workspaceSelections(state);
  const selectedAgent = findSelectedAgent(workspaceId, agents, selections);
  if (!selectedAgent) {
    delete selections[workspaceId];
    return null;
  }

  rememberSelectedAgent(workspaceId, selectedAgent, selections);

  return selectedAgent;
}

function renameWorkspace(workspace, topic) {
  const workspaceId = workspace?.workspace_id;
  const desiredLabel = workspaceLabel(topic);
  if (!workspaceId || !desiredLabel) return { changed: false, reason: "missing workspace or topic" };

  if (workspace?.label !== desiredLabel) {
    run(["workspace", "rename", workspaceId, desiredLabel]);
  }

  const changed = workspace?.label !== desiredLabel;
  const reason = changed ? undefined : "workspace label already matched";

  return { changed, reason, workspace: desiredLabel };
}

function syncWorkspace(workspace, workspaceAgents, state) {
  const selectedAgent = selectedAgentForWorkspace(workspace, workspaceAgents, state);
  if (!selectedAgent) return { changed: false, reason: "no running agents in workspace" };
  if (!selectedAgent.topic) {
    return {
      changed: false,
      reason: "selected agent has no usable topic",
      pane_id: selectedAgent.agent?.pane_id,
      workspace: workspace?.label,
    };
  }

  const result = renameWorkspace(workspace, selectedAgent.topic);

  return {
    changed: result.changed,
    reason: result.reason,
    pane_id: selectedAgent.agent.pane_id,
    workspace: result.workspace || workspace?.label,
    topic: selectedAgent.topic,
  };
}

function syncNames() {
  const agents = json(["agent", "list"])?.result?.agents || [];
  if (agents.length === 0) return { changed: false, reason: "no running agents" };

  const workspaces = json(["workspace", "list"])?.result?.workspaces || [];
  const state = loadState();
  pruneClosedWorkspaces(state, workspaces);

  const workspaceAgents = agentsByWorkspace(agents);
  const results = workspaces.map((workspace) =>
    syncWorkspace(workspace, workspaceAgents.get(workspace.workspace_id) || [], state),
  );
  const changed = results.some((result) => result.changed);

  saveState(state);

  return {
    changed,
    results,
  };
}

try {
  console.log(JSON.stringify(syncNames()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
