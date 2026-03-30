---
name: codex-session-lookback
description: Search past Codex CLI sessions by topic keyword and inspect matching transcripts. Use only when the user explicitly asks to search, find, recall, review, or check previous Codex chats, sessions, or conversations.
---

# Codex Session Lookback

Search prior Codex sessions from local storage under `~/.codex`. Start with the lightweight history index, then read the full rollout transcript only when the user asks for more detail or when history-only search is too weak.

## Storage Layout

- `~/.codex/history.jsonl`: one JSON object per user message with `session_id`, `ts`, and `text`
- `~/.codex/state_5.sqlite`: session metadata index; `threads.rollout_path` points to the full session transcript
- `~/.codex/sessions/YYYY/MM/DD/*.jsonl`: full per-session rollout transcripts

## Workflow

### 1. Search the user-message index first

Run the helper script with one or more keywords from the user's request:

```bash
python3 scripts/search_codex_sessions.py keyword1 keyword2
```

The script:

- searches `~/.codex/history.jsonl`
- groups matches by `session_id`
- ranks sessions by hit count and recency
- enriches results from `threads` in `~/.codex/state_5.sqlite`
- returns a compact JSON payload by default; use `--verbose` only when you genuinely need lower-level metadata

Prefer this path first because it is fast and usually good enough for finding the right session.

### 2. Report likely matching sessions

Summarize the strongest matches with:

- session id
- readable date
- title
- project directory (`cwd`)
- a few matched user-message previews

Keep the first reply focused on identification. Do not dump raw transcript content unless the user asks.

### 3. Inspect a specific session when needed

If the user asks what was discussed, inspect the rollout transcript:

```bash
python3 scripts/read_codex_session.py --session-id <session-id>
```

Or inspect by direct file path:

```bash
python3 scripts/read_codex_session.py --rollout-path ~/.codex/sessions/.../rollout-....jsonl
```

The script extracts the readable event stream from the JSONL transcript so you can summarize the relevant discussion.

### 4. Fall back to transcript-wide search when history misses

`history.jsonl` only indexes user messages. It will miss topics that appear only in assistant responses, tool output, or system metadata.

If there are no convincing history hits, search the full session transcripts:

```bash
rg -i "keyword" ~/.codex/sessions
```

Then use `read_codex_session.py` on the most relevant matching session.

## Output Rules

- Prefer concise summaries over raw JSON
- Include exact dates when reporting historical sessions
- Say when a result is based only on matched user messages versus full transcript inspection
- If no strong match exists, say that clearly and mention whether transcript fallback was checked

## Notes

- Use this skill only for explicit past-session lookups
- Do not treat this skill as long-term memory retrieval or project knowledge lookup
- `state_5.sqlite` is metadata and indexing, not the authoritative transcript store
