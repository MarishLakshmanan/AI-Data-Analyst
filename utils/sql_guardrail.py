"""Deterministic guardrail for LLM-generated SQL. Plain Python: no LLM, no DB."""

from __future__ import annotations

import re
from collections.abc import Mapping

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

DIALECT = "snowflake"

_FORBIDDEN = (
    exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Drop, exp.Create,
    exp.Alter, exp.TruncateTable, exp.Grant, exp.Command, exp.Use,
)


class SQLValidationError(ValueError):
    """Raised with a message written so an LLM can fix its SQL."""


def _clean(sql: str) -> str:
    sql = sql.strip()
    sql = re.sub(r"^```(?:sql)?\s*|\s*```$", "", sql, flags=re.IGNORECASE).strip()
    return sql.rstrip(";").strip()


def validate_sql(
    sql: str,
    allowed_tables: set[str],
    pii_columns: Mapping[str, set[str]] | None = None,
) -> str:
    """Return cleaned SQL if it is a single, syntactically valid, read-only query
    over allowed tables; otherwise raise SQLValidationError.

    ``pii_columns`` maps TABLE -> PII column names (see semantic_model.pii_columns)."""
    cleaned = _clean(sql)
    if not cleaned:
        raise SQLValidationError("The SQL is empty.")

    try:
        statements = [s for s in sqlglot.parse(cleaned, read=DIALECT) if s is not None]
    except ParseError as e:
        raise SQLValidationError(f"Syntax error (Snowflake dialect): {e}") from e

    if len(statements) != 1:
        raise SQLValidationError(f"Exactly one SQL statement is allowed, got {len(statements)}.")
    tree = statements[0]

    if not isinstance(tree, (exp.Select, exp.Union, exp.Subquery)):
        raise SQLValidationError("Only read-only SELECT queries (optionally with CTEs) are allowed.")
    bad = tree.find(*_FORBIDDEN)
    if bad is not None:
        raise SQLValidationError(f"Forbidden operation in query: {type(bad).__name__}.")

    allowed = {t.upper() for t in allowed_tables}
    ctes = {c.alias_or_name.upper() for c in tree.find_all(exp.CTE)}
    for table in tree.find_all(exp.Table):
        name = table.name.upper()
        if name in ctes and not table.db:
            continue
        if name not in allowed:
            raise SQLValidationError(
                f"Unknown table '{table.name}'. Allowed tables: {', '.join(sorted(allowed))}."
            )
        if table.db and table.db.upper() != "AI":
            raise SQLValidationError(f"Schema '{table.db}' is not allowed; use LOOKER.AI.")
    if pii_columns:
        _check_pii(tree, pii_columns)
    return cleaned


def _pii_ok_context(col: exp.Column) -> bool:
    """A PII column may only be counted, filtered on or joined on: never output."""
    node: exp.Expression | None = col.parent
    while node is not None:
        if isinstance(node, (exp.Count, exp.Where, exp.Join)):
            return True
        if isinstance(node, (exp.Select, exp.Subquery, exp.Union)):
            return False  # reached the enclosing query without a safe context
        node = node.parent
    return False


def _check_pii(tree: exp.Expression, pii: Mapping[str, set[str]]) -> None:
    pii = {t.upper(): {c.upper() for c in cols} for t, cols in pii.items()}
    names = {c for cols in pii.values() for c in cols}
    hint = "Personal data cannot be returned; use COUNT/COUNT(DISTINCT) or aggregate instead."

    for col in tree.find_all(exp.Column):
        if col.name.upper() in names and not _pii_ok_context(col):
            raise SQLValidationError(f"Column {col.name.upper()} is PII and cannot be selected. {hint}")

    # SELECT * / t.* would expose every column of a table that holds PII.
    for select in tree.find_all(exp.Select):
        scope = {
            (t.alias_or_name.upper()): t.name.upper()
            for t in select.find_all(exp.Table)
            if t.find_ancestor(exp.Select) is select
        }
        for e in select.expressions:
            star = isinstance(e, exp.Star) or (isinstance(e, exp.Column) and isinstance(e.this, exp.Star))
            if not star:
                continue
            qualifier = e.table.upper() if isinstance(e, exp.Column) and e.table else None
            tables = {scope[qualifier]} if qualifier in scope else set(scope.values())
            leaked = sorted(tables & pii.keys())
            if leaked:
                raise SQLValidationError(
                    f"SELECT * would expose PII columns of {', '.join(leaked)}. List the columns you need explicitly. {hint}"
                )
