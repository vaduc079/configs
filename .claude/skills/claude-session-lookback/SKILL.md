---
name: claude-session-lookback
description: Search past Claude Code sessions by topic keyword. Use ONLY when the user explicitly asks to search, find, or check past/previous Claude sessions.
---

# Claude Session Lookback Skill

Look up past Claude Code sessions using conversation history.

## How Claude Code session history works

- `~/.claude/history.jsonl` — every user message ever sent, with `sessionId`, `timestamp`, `project`, and `display` (message preview)
- `~/.claude/sessions/<pid>.json` — active sessions only (cleaned up on exit); contains `sessionId`, `pid`, `cwd`, `startedAt`
- `~/.claude/session-env/<uuid>/` — one directory per session UUID, persists after session ends
- Full transcripts at `~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl`

## Workflow

### 1. Search history.jsonl by keyword

Use `grep` on `~/.claude/history.jsonl` with the topic keywords from the user's request:

```bash
grep -i "<keyword>" ~/.claude/history.jsonl
```

Each result line is a JSON object with:

- `sessionId` — the session that message belongs to
- `display` — preview of the message content
- `timestamp` — Unix ms timestamp
- `project` — working directory at the time

### 2. Identify the relevant session(s)

From the grep results, group messages by `sessionId` to understand the conversation thread. Report back matching sessions with timestamps and message previews.

### 3. Read the full transcript (if requested)

To get the full conversation, read the transcript file:

```
~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl
```

The encoded project path replaces `/` with `-` (e.g. `/Users/duc.vu/projects/shopback/local-agent` → `-Users-duc-vu-projects-shopback-local-agent`).

## Output

Report back:

- Matching session IDs and timestamps (converted to readable date)
- Summary of what was discussed (from the `display` fields)
- Which project/directory the session was in
- Offer to read the full transcript if the user wants more detail
