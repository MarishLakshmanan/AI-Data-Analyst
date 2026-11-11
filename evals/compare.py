"""Result-set comparison for evals. Pure Python (unit-tested in tests/test_eval_compare.py)."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

Row = tuple[Any, ...]

ROUNDING_SLACK = 0.005 + 1e-9  # the agent often ROUNDs to 2 decimals


def norm(v: Any) -> Any:
    """Normalise a Snowflake value so equivalent answers compare equal."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float, Decimal)):
        return float(v)
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time(0) else v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return v if not isinstance(v, str) else v.strip()


def _eq(a: Any, b: Any, tol: float) -> bool:
    if isinstance(a, float) and isinstance(b, float):
        # relative tolerance, or the difference a 2-decimal ROUND() would introduce
        return abs(a - b) <= max(tol * max(abs(a), abs(b)), ROUNDING_SLACK)
    return a == b


def _key(v: Any) -> tuple[int, Any]:
    return (0, 0) if v is None else (1, v) if isinstance(v, float) else (2, str(v))


def _col_equal(a: list[Any], b: list[Any], tol: float) -> bool:
    return len(a) == len(b) and all(_eq(x, y, tol) for x, y in zip(sorted(a, key=_key), sorted(b, key=_key)))


def _project(actual: list[Row], expected: list[Row], tol: float) -> list[Row] | None:
    """Pick/reorder the actual columns that line up with the expected columns, by value."""
    if not expected:
        return actual
    n_exp, n_act = len(expected[0]), len(actual[0]) if actual else 0
    if n_act < n_exp:
        return None
    used: list[int] = []
    for j in range(n_exp):
        want = [r[j] for r in expected]
        i = next((i for i in range(n_act) if i not in used and _col_equal([r[i] for r in actual], want, tol)), None)
        if i is None:
            return None
        used.append(i)
    return [tuple(r[i] for i in used) for r in actual]


def compare(actual: list[Row], expected: list[Row], *, ordered: bool = False, tol: float = 1e-3) -> tuple[bool, str]:
    """Return (match, reason). Column names are ignored; extra actual columns are tolerated."""
    if len(actual) != len(expected):
        return False, f"row count {len(actual)} != expected {len(expected)}"
    if not expected:
        return True, "both empty"
    projected = _project(actual, expected, tol)
    if projected is None:
        return False, "columns do not match expected values"
    if ordered:
        for i, (a, e) in enumerate(zip(projected, expected)):
            if not all(_eq(x, y, tol) for x, y in zip(a, e)):
                return False, f"row {i} differs: {a} != {e}"
        return True, "ok"
    pool = list(projected)
    for e in expected:
        hit = next((i for i, a in enumerate(pool) if all(_eq(x, y, tol) for x, y in zip(a, e))), None)
        if hit is None:
            return False, f"expected row missing: {e}"
        pool.pop(hit)
    return True, "ok"
