"""Pydantic AI agent that writes Snowflake SQL. It never executes SQL itself;
`answer_question` runs the validated query separately via utils.snowflake_db."""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from typing import Any, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext
from snowflake.connector.errors import Error as SnowflakeError
from snowflake.connector.errors import ProgrammingError

from utils.semantic_model import allowed_tables, load_semantic_model, pii_columns, render_schema_prompt
from utils.snowflake_db import explain_query, run_query
from utils.sql_guardrail import SQLValidationError, validate_sql

load_dotenv()
log = logging.getLogger(__name__)

# OpenRouter model slug, configurable in .env (e.g. "anthropic/claude-haiku-4.5").
# Requires OPENROUTER_API_KEY.
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-haiku-4.5")
MODEL = f"openrouter:{OPENROUTER_MODEL}"


class SQLQuery(BaseModel):
    sql: str
    explanation: str
    tables_used: list[str]
    assumptions: list[str] = Field(
        default_factory=list,
        description="Every interpretation made: metric definitions, included/excluded statuses, time range, granularity.",
    )
    confidence: Literal["high", "medium", "low"] = "high"


class Clarification(BaseModel):
    """Returned instead of SQL when the question is materially ambiguous or asks for personal data."""

    question: str = Field(description="What you need to know, or why the request cannot be answered.")
    options: list[str] = Field(
        description="2-4 complete, self-contained questions the user can click to proceed."
    )


@dataclass
class SemanticContext:
    schema_prompt: str
    allowed_tables: set[str]
    pii: dict[str, set[str]]


def _build_context() -> SemanticContext:
    model = load_semantic_model()
    return SemanticContext(render_schema_prompt(model), allowed_tables(model), pii_columns(model))


agent = Agent(
    MODEL,
    output_type=[SQLQuery, Clarification],
    deps_type=SemanticContext,
    retries=3,
    defer_model_check=True,
    instructions=(
        "You translate business questions into a single Snowflake SQL query. "
        "Use only the tables, columns and joins described below. Never invent columns. "
        "Write one read-only SELECT (CTEs allowed), reference tables as LOOKER.AI.<TABLE>, "
        "and add a LIMIT unless the query is an aggregate returning few rows. "
        "When the result will be charted, aggregate in SQL (GROUP BY, date_trunc) instead of returning raw rows. "
        "Columns marked PII must never be selected, grouped or ordered by; use COUNT/COUNT(DISTINCT), filters or "
        "joins only, and never SELECT * from a table that has PII. "
        "In `assumptions` list every interpretation you made (2-5 short bullets): how each metric is defined "
        "(e.g. 'Revenue = SUM(ORDER_ITEMS.SALE_PRICE)'), which statuses are included or excluded, the time range "
        "('All time' if unfiltered) and the grouping granularity. Set confidence to 'low' if the question could "
        "reasonably mean something materially different, 'medium' if you made a notable assumption, else 'high'. "
        "Return a Clarification instead of SQL ONLY when (a) the question is so ambiguous that plausible readings "
        "give materially different answers and no reasonable default exists (e.g. 'How are we doing?'), or (b) the "
        "user asks for personal data (emails, names, street addresses, IP addresses): say you cannot return it and "
        "offer 2-4 aggregate alternatives as options. Each option must be a complete question. When a reasonable "
        "default exists, use it and record it in `assumptions` instead of asking. "
        "Note ORDERS.RETURNED_AT is a VARCHAR. You cannot run queries; only return the SQL."
    ),
)


@agent.instructions
def schema_instructions(ctx: RunContext[SemanticContext]) -> str:
    return ctx.deps.schema_prompt


def _compile_check_enabled() -> bool:
    return os.getenv("SQL_COMPILE_CHECK", "true").lower() not in ("0", "false", "no")


@agent.output_validator
def check_sql(
    ctx: RunContext[SemanticContext], output: SQLQuery | Clarification
) -> SQLQuery | Clarification:
    if isinstance(output, Clarification):
        if not 2 <= len(output.options) <= 4:
            raise ModelRetry("A Clarification needs 2-4 options. Provide between 2 and 4.")
        return output
    try:
        output.sql = validate_sql(output.sql, ctx.deps.allowed_tables, ctx.deps.pii)
    except SQLValidationError as e:
        raise ModelRetry(f"Invalid SQL: {e} Fix it and try again.") from e

    # Let Snowflake compile the query (no execution) so unknown columns / type errors
    # become retries instead of failures the user sees.
    if _compile_check_enabled():
        try:
            explain_query(output.sql)
        except ProgrammingError as e:
            raise ModelRetry(f"Snowflake rejected the SQL: {e.msg or e}. Fix it and try again.") from e
        except (SnowflakeError, RuntimeError) as e:
            # Connectivity/config problems are not the model's fault; skip the check.
            log.warning("SQL compile check skipped: %s", e)
    return output


def build_prompt(question: str, previous: dict[str, str] | None = None) -> str:
    """For follow-ups, give the agent the previous query so it edits it instead of starting over."""
    if not previous:
        return question
    return (
        f"Previous question: {previous['question']}\n"
        f"Previous SQL:\n```sql\n{previous['sql']}\n```\n\n"
        f"Follow-up request: {question}\n\n"
        "Modify the previous SQL to answer the follow-up: keep the parts that still apply "
        "(joins, metric definitions, filters) and change only what the follow-up asks for. "
        "Say what you changed in `assumptions`."
    )


def generate_sql(question: str, previous: dict[str, str] | None = None) -> SQLQuery | Clarification:
    return agent.run_sync(build_prompt(question, previous), deps=_build_context()).output


def answer_question(question: str) -> tuple[SQLQuery | Clarification, list[dict[str, Any]]]:
    query = generate_sql(question)
    if isinstance(query, Clarification):
        return query, []
    rows = run_query(query.sql)  # executed by plain Python, not the agent
    return query, rows


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--no-run"]
    no_run = "--no-run" in sys.argv[1:]
    if no_run:
        os.environ["SQL_COMPILE_CHECK"] = "false"  # --no-run means: don't touch Snowflake
    question = " ".join(args) or input("Question: ")
    query = generate_sql(question)
    if isinstance(query, Clarification):
        print(f"{query.question}\n" + "\n".join(f"  - {o}" for o in query.options))
        return
    print(f"SQL:\n{query.sql}\n\nExplanation: {query.explanation}")
    print("Assumptions:\n" + "\n".join(f"  - {a}" for a in query.assumptions) + f"\nConfidence: {query.confidence}")
    if not no_run:
        for row in run_query(query.sql):
            print(row)


if __name__ == "__main__":
    main()
