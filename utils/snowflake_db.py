"""Snowflake connection helpers. Plain Python: no LLM involvement."""

from __future__ import annotations

import os
from typing import Any

import snowflake.connector
from dotenv import load_dotenv
from snowflake.connector import DictCursor, SnowflakeConnection

load_dotenv()

_REQUIRED = ("SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_WAREHOUSE")


def get_connection() -> SnowflakeConnection:
    missing = [v for v in _REQUIRED if not os.getenv(v)]
    key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH")
    if not key_path and not os.getenv("SNOWFLAKE_PASSWORD"):
        missing.append("SNOWFLAKE_PRIVATE_KEY_PATH (or SNOWFLAKE_PASSWORD)")
    if missing:
        raise RuntimeError(f"Missing Snowflake environment variables: {', '.join(missing)}")

    params: dict[str, Any] = {
        "account": os.environ["SNOWFLAKE_ACCOUNT"],
        "user": os.environ["SNOWFLAKE_USER"],
        "warehouse": os.environ["SNOWFLAKE_WAREHOUSE"],
        "database": os.getenv("SNOWFLAKE_DATABASE", "LOOKER"),
        "schema": os.getenv("SNOWFLAKE_SCHEMA", "AI"),
        # Kill runaway queries instead of burning warehouse credits.
        "session_parameters": {
            "STATEMENT_TIMEOUT_IN_SECONDS": int(os.getenv("SNOWFLAKE_STATEMENT_TIMEOUT", "60")),
        },
    }
    if key_path:
        # Key-pair auth (preferred). Passphrase is optional for encrypted keys.
        params["private_key_file"] = key_path
        if pwd := os.getenv("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE"):
            params["private_key_file_pwd"] = pwd
    else:
        params["password"] = os.environ["SNOWFLAKE_PASSWORD"]
    if role := os.getenv("SNOWFLAKE_ROLE"):
        params["role"] = role
    return snowflake.connector.connect(**params)


def run_query_limited(
    sql: str, params: Any = None, max_rows: int | None = 1000
) -> tuple[list[dict[str, Any]], bool]:
    """Execute ``sql``; return (rows, truncated). ``truncated`` is True when more than
    ``max_rows`` rows existed (None = no limit)."""
    with get_connection() as conn, conn.cursor(DictCursor) as cur:
        cur.execute(sql, params)
        if max_rows is None:
            return cur.fetchall(), False
        rows = cur.fetchmany(max_rows + 1)
        return rows[:max_rows], len(rows) > max_rows


def run_query(sql: str, params: Any = None, max_rows: int | None = 1000) -> list[dict[str, Any]]:
    """Execute ``sql`` and return rows as dicts (at most ``max_rows``; None = all)."""
    return run_query_limited(sql, params, max_rows)[0]


def explain_query(sql: str) -> None:
    """Compile ``sql`` on Snowflake without running it (no warehouse credits).
    Raises snowflake.connector.errors.ProgrammingError for unknown columns, bad types, etc."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f"EXPLAIN USING TEXT {sql}")
