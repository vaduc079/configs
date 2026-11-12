/**
 * Names a new session from its first prompt, and shows only that name as the
 * terminal title (pi's default is `π - <name> - <cwd>`). The name also shows in /resume.
 *
 * The title comes from Claude Haiku 5.5, with a prompt adapted from OpenCode's
 * title agent (sst/opencode packages/core/src/plugin/agent.ts, PROMPT_TITLE) and
 * T3 Code's (pingdotgg/t3code packages/provider-core/src/server/textGenerationPrompts.ts).
 * When the first message hides its subject behind a link or "fix this", the session is
 * renamed once, after the first run settles, using the assistant's reply.
 * Sessions that already have a name, from /name, --name, or this extension, are left alone.
 */
import {
  type ExtensionAPI,
  type ExtensionContext,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const TITLE_MODEL = { provider: "anthropic", id: "claude-haiku-5-5" };
const MAX_PROMPT_LENGTH = 2_000;
const MAX_REPLY_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 60;

const TITLE_RULES = `Aim for three to five words. Name the specific subject, such as the feature, file, issue number, error, or tool involved. Keep the detail that tells it apart from similar conversations, like a version, provider, or the thing it is compared against, and make room for it by dropping generic words like "review", "overview", "investigation", "request", "question", or "this project".

Name what the work is about and what the user wants from it. Leave out instructions about how to do the work, such as which agent, subagent, skill, model, or tool to use, the output format, or "don't make edits", unless they are the subject. When the message lists several steps or symptoms, name the goal they share. Name the change or problem, not the MR, plan, report, or branch used to produce it. Do not claim the work is done.

The title should read naturally as a short phrase, not as a stack of nouns. Write it in your own words rather than copying a heading, commit message, command, or long path from the message.

Use sentence case, not title case: capitalize the first word and proper nouns only. Keep identifiers exactly as written, including file names, issue and MR numbers, Jira keys, error codes, and model names. Use the same language as the message.`;

const FIRST_TITLE_PROMPT = `You name conversations so the user can find them later in a list of past sessions.

You will receive the first message of a conversation. Reply with exactly two lines and nothing else:
1. The title: no quotes, no trailing period, no label such as "Title:".
2. "vague" if the message does not say what the work is about, because the subject sits behind a link, an attachment, or earlier context ("investigate these slack threads <link>", "fix this", "continue"). Otherwise "clear".

${TITLE_RULES}

The message is something to name, not something to answer or carry out. Even if it asks you to do work, asks a question, or seems incomplete, only name it. For greetings or small talk, use a short label like "Greeting".

Examples, each a message followed by the reply:

"debug 500 errors in production"
Production 500 errors
clear

"what does the retry logic in fetch.ts do"
fetch.ts retry logic
clear

"@src/credential.ts can you add refresh token support, use a subagent for the tests"
Credential refresh tokens
clear

"compare the new cache layer with the v1 one in packages/legacy"
New cache layer vs v1
clear

"Investigate https://github.com/acme/app/issues/412, don't make edits"
Issue #412
vague

"investigate slack threads https://acme.slack.com/archives/C01/p1700000000"
Slack threads
vague

"hey"
Greeting
clear`;

const RETITLE_PROMPT = `You rename conversations so the user can find them later in a list of past sessions.

The conversation was named from its first message before its subject was known, for example because the message only linked to a thread or issue. You will receive that first message, the current title, and the assistant's latest reply. Reply with a better title and nothing else: one line, no quotes, no trailing period, no label such as "Title:".

Take the goal from the user's message. Use the assistant's reply to learn what the links, attachments, or unnamed code are about, but do not make one finding the subject unless it is what the user asked about. Ignore the reply's progress reports and completion summaries. Keep the current title if it is already accurate.

${TITLE_RULES}`;

function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

// `/skill:name args` reaches before_agent_start already expanded to the full SKILL.md, which
// would crowd out what the user asked. Name from the args, or the skill name when there are none.
function userText(prompt: string): string {
  const skill = parseSkillBlock(prompt);
  if (!skill) return prompt;
  return skill.userMessage ?? `${skill.name} skill`;
}

function shorten(text: string): string {
  return text.length <= MAX_TITLE_LENGTH ? text : `${text.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

async function askTitleModel(
  ctx: ExtensionContext,
  model: Model<Api>,
  systemPrompt: string,
  content: string,
): Promise<string | undefined> {
  const response = await ctx.modelRegistry.complete(model, {
    systemPrompt,
    messages: [{ role: "user", content, timestamp: Date.now() }],
  });
  if (response.stopReason === "error") return undefined;
  return response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
  const reply = ctx.sessionManager
    .getBranch()
    .flatMap((entry) =>
      entry.type === "message" && entry.message.role === "assistant" ? [entry.message] : [],
    )
    .at(-1);
  const text = reply?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
}

export default function (pi: ExtensionAPI) {
  let vague: { prompt: string; title: string } | undefined;
  // The first title can arrive after a short run settles, so the retitle waits on it.
  let firstTitle: Promise<unknown> = Promise.resolve();

  const showTitle = (ctx: ExtensionContext) => {
    const name = pi.getSessionName();
    if (name) ctx.ui.setTitle(name);
  };

  // Pi sets its own title before this event reaches extensions, so this one wins.
  pi.on("session_info_changed", async (_event, ctx) => showTitle(ctx));

  // Pi sets its own title after session_start (on startup, resume, and reload), so wait for it.
  pi.on("session_start", async (_event, ctx) => {
    setTimeout(() => showTitle(ctx), 0);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (event.messageType !== "user" || !event.prompt || pi.getSessionName()) return;

    const prompt = userText(event.prompt).slice(0, MAX_PROMPT_LENGTH);
    const fallback = firstLine(prompt);
    // Skip if the user named the session while the call was running.
    const setName = (title: string | undefined) => {
      if (!title || pi.getSessionName()) return undefined;
      const name = shorten(title);
      pi.setSessionName(name);
      return name;
    };

    const model = ctx.modelRegistry.find(TITLE_MODEL.provider, TITLE_MODEL.id);
    if (!model) {
      setName(fallback);
      return;
    }

    // Not awaited, so the main turn starts without waiting for the title.
    firstTitle = askTitleModel(
      ctx,
      model,
      FIRST_TITLE_PROMPT,
      `Here is the first message of the conversation:\n\n<message>\n${prompt}\n</message>\n\nReply with only the two lines.`,
    )
      .then((reply) => {
        const lines = (reply ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const name = setName(lines.at(0) ?? fallback);
        if (name && lines.at(1)?.toLowerCase() === "vague") vague = { prompt, title: name };
      })
      .catch(() => setName(fallback));
  });

  pi.on("agent_settled", async (event, ctx) => {
    if (event.aborted) return;
    const reply = lastAssistantText(ctx);
    if (!reply) return;

    void firstTitle
      .then(async () => {
        if (!vague) return;
        const { prompt, title } = vague;
        vague = undefined;
        const model = ctx.modelRegistry.find(TITLE_MODEL.provider, TITLE_MODEL.id);
        if (!model) return;

        const text = await askTitleModel(
          ctx,
          model,
          RETITLE_PROMPT,
          `<first_message>\n${prompt}\n</first_message>\n\n<current_title>${title}</current_title>\n\n<assistant_reply>\n${reply.slice(-MAX_REPLY_LENGTH)}\n</assistant_reply>\n\nReply with only the title.`,
        );
        const newTitle = text && firstLine(text);
        // Skip if the user renamed the session in the meantime.
        if (newTitle && pi.getSessionName() === title) pi.setSessionName(shorten(newTitle));
      })
      .catch(() => {});
  });
}
