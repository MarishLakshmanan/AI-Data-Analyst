"""Small SQLite store for user feedback and human-approved verified queries.
Plain Python (stdlib sqlite3): no LLM, no Snowflake. The file lives in ``data/`` (gitignored)."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    question TEXT NOT NULL,
    sql TEXT NOT NULL,
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
    comment TEXT,
    promoted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS verified_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL UNIQUE,
    sql TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    source_feedback_id INTEGER
);
"""


def db_path() -> Path:
    return Path(os.getenv("APP_DB_PATH", DEFAULT_PATH))


def _connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def add_feedback(
    question: str,
    sql: str,
    rating: str,
    assumptions: list[str] | None = None,
    comment: str | None = None,
    *,
    path: Path | None = None,
) -> int:
    with closing(_connect(path)) as conn, conn:
        cur = conn.execute(
            "INSERT INTO feedback (ts, question, sql, assumptions_json, rating, comment) VALUES (?,?,?,?,?,?)",
            (_now(), question, sql, json.dumps(assumptions or []), rating, comment or None),
        )
        return int(cur.lastrowid)


def list_feedback(
    rating: str | None = None, *, only_unpromoted: bool = False, path: Path | None = None
) -> list[dict[str, Any]]:
    where, args = [], []
    if rating:
        where.append("rating = ?")
        args.append(rating)
    if only_unpromoted:
        where.append("promoted = 0")
    sql = "SELECT * FROM feedback" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id"
    with closing(_connect(path)) as conn:
        rows = [dict(r) for r in conn.execute(sql, args)]
    for r in rows:
        r["assumptions"] = json.loads(r.pop("assumptions_json"))
    return rows


def add_verified(question: str, sql: str, source_feedback_id: int | None = None, *, path: Path | None = None) -> None:
    """Approve a query as a verified example (replaces an earlier one for the same question)
    and mark the originating feedback as promoted."""
    with closing(_connect(path)) as conn, conn:
        conn.execute(
            "INSERT INTO verified_queries (question, sql, approved_at, source_feedback_id) VALUES (?,?,?,?) "
            "ON CONFLICT(question) DO UPDATE SET sql=excluded.sql, approved_at=excluded.approved_at, "
            "source_feedback_id=excluded.source_feedback_id",
            (question, sql, _now(), source_feedback_id),
        )
        # Also retire duplicate 👍 votes for the same question so they don't resurface in review.
        conn.execute(
            "UPDATE feedback SET promoted = 1 WHERE id = ? OR (question = ? AND rating = 'up')",
            (source_feedback_id, question),
        )


def list_verified(*, path: Path | None = None) -> list[dict[str, Any]]:
    if not (path or db_path()).exists():
        return []  # nothing approved yet; don't create the file just to read it
    with closing(_connect(path)) as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM verified_queries ORDER BY id")]
