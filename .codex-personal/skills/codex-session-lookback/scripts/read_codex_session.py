#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Read a Codex rollout transcript by session id or direct path."
    )
    parser.add_argument("--session-id", help="Session id to resolve through state_5.sqlite")
    parser.add_argument("--rollout-path", help="Direct path to a rollout JSONL file")
    parser.add_argument(
        "--codex-home",
        default=os.environ.get("CODEX_HOME", str(Path.home() / ".codex")),
        help="Codex home directory; defaults to $CODEX_HOME or ~/.codex",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=80,
        help="Maximum extracted events to return",
    )
    parser.add_argument(
        "--include-system",
        action="store_true",
        help="Include system and developer messages in the extracted event stream",
    )
    args = parser.parse_args()

    if not args.session_id and not args.rollout_path:
        parser.error("provide --session-id or --rollout-path")

    return args


def ts_to_iso(ts):
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat()


def summarize_session_meta(payload):
    if not isinstance(payload, dict):
        return payload

    keys = [
        "id",
        "timestamp",
        "cwd",
        "originator",
        "cli_version",
        "source",
        "model_provider",
    ]
    return {key: payload.get(key) for key in keys if key in payload}


def resolve_rollout_path(codex_home, session_id):
    db_path = codex_home / "state_5.sqlite"
    if not db_path.exists():
        raise FileNotFoundError(f"state database not found: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT rollout_path FROM threads WHERE id = ?",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()

    if not row or not row[0]:
        raise FileNotFoundError(f"no rollout found for session id: {session_id}")

    return Path(row[0]).expanduser()


def extract_text_from_message_content(content):
    if not isinstance(content, list):
        return None

    chunks = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text.strip())

    if not chunks:
        return None

    return "\n".join(chunks)


def parse_event(line, include_system):
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None

    event_type = record.get("type")
    payload = record.get("payload")
    timestamp = record.get("timestamp")

    if event_type == "session_meta":
        return {
            "kind": "session_meta",
            "timestamp": timestamp,
            "summary": summarize_session_meta(payload),
        }

    if event_type == "event_msg" and isinstance(payload, dict):
        payload_type = payload.get("type")
        if payload_type == "user_message":
            return {
                "kind": "user_message",
                "timestamp": timestamp,
                "summary": payload.get("message"),
            }
        if payload_type == "agent_message":
            return {
                "kind": "agent_message",
                "timestamp": timestamp,
                "summary": payload.get("message"),
            }

    if event_type == "response_item" and isinstance(payload, dict):
        item_type = payload.get("type")
        if item_type == "message":
            content = payload.get("content")
            role = payload.get("role")
            if role in {"system", "developer"} and not include_system:
                return None
            return {
                "kind": "message",
                "timestamp": timestamp,
                "summary": extract_text_from_message_content(content),
                "role": role,
                "phase": payload.get("phase"),
            }
        if item_type == "function_call":
            return {
                "kind": "function_call",
                "timestamp": timestamp,
                "name": payload.get("name"),
                "arguments": payload.get("arguments"),
            }
        if item_type == "function_call_output":
            output = payload.get("output")
            return {
                "kind": "function_call_output",
                "timestamp": timestamp,
                "call_id": payload.get("call_id"),
                "output_preview": output[:500] if isinstance(output, str) else None,
            }

    return None


def main():
    args = parse_args()
    codex_home = Path(args.codex_home).expanduser()
    rollout_path = (
        resolve_rollout_path(codex_home, args.session_id)
        if args.session_id
        else Path(args.rollout_path).expanduser()
    )

    if not rollout_path.exists():
        print(json.dumps({"error": f"rollout file not found: {rollout_path}"}, ensure_ascii=True))
        return 1

    extracted = []
    session_meta = None

    with rollout_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            event = parse_event(line, args.include_system)
            if not event:
                continue
            if event["kind"] == "session_meta" and session_meta is None:
                session_meta = event["summary"]
                continue
            if len(extracted) < args.limit:
                extracted.append(event)

    output = {
        "rollout_path": str(rollout_path),
        "session_id": args.session_id or (session_meta or {}).get("id"),
        "session_meta": session_meta,
        "events": extracted,
    }
    print(json.dumps(output, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
