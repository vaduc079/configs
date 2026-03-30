#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Search Codex session history by keyword and rank matching sessions."
    )
    parser.add_argument("keywords", nargs="+", help="One or more keywords to search for")
    parser.add_argument("--limit", type=int, default=3, help="Maximum sessions to return")
    parser.add_argument(
        "--message-limit",
        type=int,
        default=3,
        help="Maximum matched message previews to include per session",
    )
    parser.add_argument(
        "--all-keywords",
        action="store_true",
        help="Require every keyword to appear in a history entry",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Include lower-level metadata such as rollout path and provider fields",
    )
    parser.add_argument(
        "--codex-home",
        default=os.environ.get("CODEX_HOME", str(Path.home() / ".codex")),
        help="Codex home directory; defaults to $CODEX_HOME or ~/.codex",
    )
    return parser.parse_args()


def load_thread_metadata(db_path, session_ids):
    metadata = {}
    if not db_path.exists() or not session_ids:
        return metadata

    conn = sqlite3.connect(db_path)
    try:
        placeholders = ",".join("?" for _ in session_ids)
        cursor = conn.execute(
            f"""
            SELECT id, title, cwd, rollout_path, archived, source, model_provider, first_user_message
            FROM threads
            WHERE id IN ({placeholders})
            """,
            tuple(session_ids),
        )
        for row in cursor:
            metadata[row[0]] = {
                "title": row[1],
                "cwd": row[2],
                "rollout_path": row[3],
                "archived": bool(row[4]),
                "source": row[5],
                "model_provider": row[6],
                "first_user_message": row[7],
            }
    finally:
        conn.close()

    return metadata


def entry_matches(text, keywords, require_all):
    haystack = text.lower()
    matched = [keyword for keyword in keywords if keyword in haystack]
    if require_all:
        return len(matched) == len(keywords), matched
    return bool(matched), matched


def ts_to_iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat()


def trim_text(text, limit=180):
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def main():
    args = parse_args()
    codex_home = Path(args.codex_home).expanduser()
    history_path = codex_home / "history.jsonl"
    state_db_path = codex_home / "state_5.sqlite"

    if not history_path.exists():
        print(
            json.dumps(
                {"error": f"history file not found: {history_path}"},
                ensure_ascii=True,
            )
        )
        return 1

    keywords = [keyword.lower() for keyword in args.keywords]
    grouped = defaultdict(
        lambda: {
            "session_id": None,
            "match_count": 0,
            "latest_ts": 0,
            "matched_messages": [],
        }
    )

    with history_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            text = entry.get("text", "")
            session_id = entry.get("session_id")
            ts = entry.get("ts")

            if not session_id or not isinstance(text, str) or not isinstance(ts, int):
                continue

            matched, matched_keywords = entry_matches(text, keywords, args.all_keywords)
            if not matched:
                continue

            bucket = grouped[session_id]
            bucket["session_id"] = session_id
            bucket["match_count"] += 1
            bucket["latest_ts"] = max(bucket["latest_ts"], ts)
            bucket["matched_messages"].append(
                {
                    "ts": ts,
                    "iso_time": ts_to_iso(ts),
                    "matched_keywords": matched_keywords,
                    "text": text,
                }
            )

    if not grouped:
        output = {
            "keywords": args.keywords,
            "result_count": 0,
            "results": [],
        }
        print(json.dumps(output, indent=2, ensure_ascii=True))
        return 0

    thread_metadata = load_thread_metadata(state_db_path, grouped.keys())
    results = []
    for session_id, bucket in grouped.items():
        meta = thread_metadata.get(session_id, {})
        bucket["matched_messages"].sort(key=lambda item: item["ts"], reverse=True)
        session_result = {
            "session_id": session_id,
            "_latest_ts": bucket["latest_ts"],
            "latest_time": ts_to_iso(bucket["latest_ts"]) if bucket["latest_ts"] else None,
            "title": meta.get("title"),
            "cwd": meta.get("cwd"),
            "match_count": bucket["match_count"],
            "matched_messages": [
                {
                    "time": item["iso_time"],
                    "text": trim_text(item["text"]),
                }
                for item in bucket["matched_messages"][: args.message_limit]
            ],
        }
        if args.verbose:
            session_result["rollout_path"] = meta.get("rollout_path")
            session_result["archived"] = meta.get("archived")
            session_result["source"] = meta.get("source")
            session_result["model_provider"] = meta.get("model_provider")
            session_result["first_user_message"] = meta.get("first_user_message")
        results.append(session_result)

    results.sort(key=lambda item: (-item["match_count"], -item["_latest_ts"], item["session_id"]))
    for item in results:
        item.pop("_latest_ts", None)
    output = {
        "keywords": args.keywords,
        "result_count": len(results),
        "results": results[: args.limit],
    }
    print(json.dumps(output, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
