"""FastAPI service exposing the text-to-SQL agent.

Run from the project root:  uv run uvicorn app.main:app --reload
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pydantic_ai.exceptions import UnexpectedModelBehavior
from snowflake.connector.errors import Error as SnowflakeError

from app.AI.sql_agent import Clarification, generate_sql
from utils.semantic_model import allowed_tables, load_semantic_model, pii_columns
from utils import app_db
from utils.insights import compute_insights
from utils.snowflake_db import run_query_limited
from utils.sql_guardrail import SQLValidationError, validate_sql

app = FastAPI(title="AI Data Analyst")

ColumnType = Literal["number", "string", "date", "boolean"]


class Column(BaseModel):
    name: str
    type: ColumnType


class PreviousQuery(BaseModel):
    question: str
    sql: str


class QueryRequest(BaseModel):
    question: str = Field(min_length=1, examples=["Which 10 products have been purchased the most?"])
    run: bool = Field(default=True, description="Execute the SQL on Snowflake and return rows.")
    previous: PreviousQuery | None = Field(default=None, description="Earlier query to refine (follow-ups).")


class Insight(BaseModel):
    kind: str
    text: str


class ClarificationOut(BaseModel):
    question: str
    options: list[str]


class QueryResponse(BaseModel):
    kind: Literal["sql", "clarification"] = "sql"
    sql: str = ""
    explanation: str = ""
    tables_used: list[str] = []
    assumptions: list[str] = []
    confidence: Literal["high", "medium", "low"] = "high"
    rows: list[dict[str, Any]] | None = None
    columns: list[Column] | None = None
    truncated: bool = False
    insights: list[Insight] = []
    clarification: ClarificationOut | None = None


class ExecuteRequest(BaseModel):
    sql: str = Field(min_length=1)


class ExecuteResponse(BaseModel):
    sql: str
    rows: list[dict[str, Any]]
    columns: list[Column]
    truncated: bool = False
    insights: list[Insight] = []


def _to_json_value(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, bytes):
        return v.hex()
    return v


def _column_type(v: Any) -> ColumnType:
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float, Decimal)):
        return "number"
    if isinstance(v, (dt.date, dt.datetime)):
        return "date"
    return "string"


def _jsonable(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[Column]]:
    """Make Snowflake rows JSON-friendly (Decimal -> float, dates -> ISO) and infer
    a simple type per column from its first non-null value."""
    names: list[str] = list(rows[0].keys()) if rows else []
    columns = []
    for name in names:
        sample = next((r[name] for r in rows if r.get(name) is not None), None)
        columns.append(Column(name=name, type=_column_type(sample) if sample is not None else "string"))
    clean = [{k: _to_json_value(v) for k, v in r.items()} for r in rows]
    return clean, columns


def _execute(sql: str) -> tuple[list[dict[str, Any]], list[Column], bool, list[Insight]]:
    try:
        rows, truncated = run_query_limited(sql)
    except (SnowflakeError, RuntimeError) as e:
        raise HTTPException(502, f"Snowflake query failed: {e}") from e
    clean, columns = _jsonable(rows)
    insights = [Insight(**i) for i in compute_insights(clean, [c.model_dump() for c in columns])]
    return clean, columns, truncated, insights


class FeedbackRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    sql: str = Field(min_length=1, max_length=20000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    rating: Literal["up", "down"]
    comment: str | None = Field(default=None, max_length=2000)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Plain `def` so FastAPI runs these blocking calls in its threadpool.
@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    # 1. The agent only writes SQL; the guardrail validates it inside the agent.
    try:
        result = generate_sql(req.question, req.previous.model_dump() if req.previous else None)
    except UnexpectedModelBehavior as e:
        raise HTTPException(422, f"Could not produce valid SQL: {e}") from e

    if isinstance(result, Clarification):  # nothing to execute
        return QueryResponse(kind="clarification", clarification=ClarificationOut(**result.model_dump()))

    # 2. Execution is separate, plain Python.
    rows = columns = None
    truncated = False
    insights: list[Insight] = []
    if req.run:
        rows, columns, truncated, insights = _execute(result.sql)

    return QueryResponse(
        **result.model_dump(), rows=rows, columns=columns, truncated=truncated, insights=insights
    )


@app.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest) -> ExecuteResponse:
    """Re-run previously generated SQL (e.g. refreshing a pinned chart).
    Client-supplied SQL always goes through the guardrail first."""
    try:
        model = load_semantic_model()
        sql = validate_sql(req.sql, allowed_tables(model), pii_columns(model))
    except SQLValidationError as e:
        raise HTTPException(400, f"Rejected by SQL guardrail: {e}") from e
    rows, columns, truncated, insights = _execute(sql)
    return ExecuteResponse(sql=sql, rows=rows, columns=columns, truncated=truncated, insights=insights)


@app.post("/feedback")
def feedback(req: FeedbackRequest) -> dict[str, int]:
    """Record a 👍/👎. Nothing here reaches the agent: a human must approve it first
    (scripts/review_feedback.py), which re-validates the SQL."""
    return {"id": app_db.add_feedback(req.question, req.sql, req.rating, req.assumptions, req.comment)}
