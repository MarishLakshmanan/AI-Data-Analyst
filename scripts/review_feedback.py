"""Review user feedback and promote good answers to verified examples. Nothing is automatic:
each 👍 query is shown to you, re-validated (guardrail + Snowflake compile), and only then
added to the agent's examples and to the eval golden set.

    uv run python -m scripts.review_feedback             # review 👍 not yet promoted
    uv run python -m scripts.review_feedback --failures  # list 👎 with comments
    uv run python -m scripts.review_feedback --no-explain  # skip the Snowflake compile check
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from utils import app_db
from utils.semantic_model import allowed_tables, load_semantic_model, pii_columns
from utils.sql_guardrail import SQLValidationError, validate_sql

GOLDEN = Path(__file__).resolve().parent.parent / "evals" / "golden.yaml"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "case"


def append_golden_case(case_id: str, question: str, sql: str, path: Path = GOLDEN) -> bool:
    """Append a regression case (text append keeps the file's comments/formatting).
    Returns False when the question is already in the file."""
    text = path.read_text() if path.exists() else "cases:\n"
    if json.dumps(question) in text or f"question: {question}\n" in text:
        return False
    entry = (
        f"\n  - id: {case_id}\n"
        f"    question: {json.dumps(question)}\n"  # JSON strings are valid YAML scalars
        f"    tags: [feedback]\n"
        f"    reference_sql: |\n{textwrap.indent(sql, '      ')}\n"
    )
    path.write_text(text.rstrip("\n") + "\n" + entry)
    return True


def promote(
    row: dict[str, Any],
    sql: str | None = None,
    *,
    explain: bool = True,
    golden_path: Path = GOLDEN,
    db_path: Path | None = None,
) -> str:
    """Validate and approve one feedback row. Raises SQLValidationError (or Snowflake's
    ProgrammingError when ``explain``) if the SQL is not safe/valid; nothing is written then."""
    model = load_semantic_model(include_approved=False)
    clean = validate_sql(sql or row["sql"], allowed_tables(model), pii_columns(model))
    if explain:
        from utils.snowflake_db import explain_query

        explain_query(clean)
    app_db.add_verified(row["question"], clean, row["id"], path=db_path)
    case_id = f"fb_{row['id']}_{_slug(row['question'])}"
    append_golden_case(case_id, row["question"], clean, golden_path)
    return case_id


def _edit(sql: str) -> str:
    with tempfile.NamedTemporaryFile("w+", suffix=".sql", delete=False) as f:
        f.write(sql)
        name = f.name
    try:
        subprocess.run([os.getenv("EDITOR", "vi"), name], check=False)
        return Path(name).read_text().strip()
    finally:
        os.unlink(name)


def _show(row: dict[str, Any]) -> None:
    print(f"\n#{row['id']}  {row['ts']}  [{row['rating']}]\nQuestion: {row['question']}")
    for a in row["assumptions"]:
        print(f"  - {a}")
    print(f"\n{row['sql']}\n")
    if row.get("comment"):
        print(f"Comment: {row['comment']}")


def review(explain: bool, golden: Path = GOLDEN) -> None:
    rows, seen = [], set()
    for r in app_db.list_feedback("up", only_unpromoted=True):
        if (r["question"], r["sql"]) not in seen:  # one prompt per distinct answer
            seen.add((r["question"], r["sql"]))
            rows.append(r)
    if not rows:
        print("No 👍 feedback waiting for review.")
        return
    for r in rows:
        _show(r)
        sql = None
        while True:
            choice = input("[a]pprove  [e]dit  [s]kip  [q]uit > ").strip().lower()
            if choice == "e":
                sql = _edit(sql or r["sql"])
                print(f"\n{sql}\n")
            elif choice == "a":
                try:
                    case_id = promote(r, sql, explain=explain, golden_path=golden)
                except SQLValidationError as e:
                    print(f"Rejected by guardrail: {e}")
                    continue
                except Exception as e:  # noqa: BLE001 - e.g. Snowflake compile error; let the reviewer edit
                    print(f"Not promoted: {e}")
                    continue
                print(f"Approved. Added to the agent examples and the golden eval file as {case_id}.")
                break
            elif choice == "s":
                break
            elif choice == "q":
                return


def failures() -> None:
    rows = app_db.list_feedback("down")
    if not rows:
        print("No 👎 feedback.")
    for r in rows:
        _show(r)
    if rows:
        print("Turn these into eval cases in evals/golden.yaml once you know the right answer.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--failures", action="store_true", help="list 👎 feedback instead of reviewing 👍")
    ap.add_argument("--golden", type=Path, default=GOLDEN, help="golden eval file to append to")
    ap.add_argument("--no-explain", action="store_true", help="skip the Snowflake compile check")
    args = ap.parse_args()
    failures() if args.failures else review(explain=not args.no_explain, golden=args.golden)


if __name__ == "__main__":
    main()
