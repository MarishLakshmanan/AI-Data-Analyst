"""Deterministic insights computed from query results. Plain Python: no LLM, no DB.

The chat model narrates these facts instead of eyeballing 5 sample rows, so numbers in the
answer are computed, not guessed."""

from __future__ import annotations

import re
from typing import Any

MAX_INSIGHTS = 5
# Columns where summing / "share of total" is meaningful (not averages, prices, ages...).
_ADDITIVE = re.compile(r"(count|total|sum|revenue|sales|orders|units|qty|quantity|amount|purchases|users|sessions|events|num)", re.I)
_NON_ADDITIVE = re.compile(r"(avg|average|mean|median|rate|ratio|pct|percent|price|age|days|latitude|longitude)", re.I)


def _fmt(v: float) -> str:
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:,.2f}".rstrip("0").rstrip(".")


def _pct(v: float) -> str:
    return f"{v:+.1f}%"


# Numeric columns that are identifiers, positions or coordinates, not measures.
_NOT_A_METRIC = re.compile(
    r"^(id|rank|index|idx)$|_id$|(^|_)(since|period|index|rank|seq|sequence|year|month|day|week|hour|lat|lon|lng|latitude|longitude)(_|$)",
    re.I,
)


def _additive(name: str) -> bool:
    return bool(_ADDITIVE.search(name)) and not _NON_ADDITIVE.search(name)


def _label(name: str) -> str:
    return name.lower().replace("_", " ")


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def compute_insights(rows: list[dict[str, Any]], columns: list[dict[str, str]]) -> list[dict[str, str]]:
    """``rows`` are JSON-safe dicts; ``columns`` are ``{name, type}``. Returns ``[{kind, text}]``."""
    if len(rows) < 2:
        return []
    nums = [c["name"] for c in columns if c["type"] == "number" and not _NOT_A_METRIC.search(c["name"])]
    dates = [c["name"] for c in columns if c["type"] == "date"]
    cats = [c["name"] for c in columns if c["type"] in ("string", "boolean")]
    out: list[dict[str, str]] = []

    def add(kind: str, text: str) -> None:
        out.append({"kind": kind, "text": text})

    def values(col: str) -> list[float]:
        return [float(r[col]) for r in rows if isinstance(r.get(col), (int, float)) and not isinstance(r.get(col), bool)]

    # --- trend over time -------------------------------------------------------------
    if dates and nums:
        d, n = dates[0], nums[0]
        series = sorted(((str(r[d])[:10], float(r[n])) for r in rows if r.get(d) is not None and r.get(n) is not None))
        # Repeated dates mean another dimension is in play (cohorts, groups): a single trend would mix them.
        if len(series) >= 2 and len({d_ for d_, _ in series}) == len(series):
            first, last = series[0], series[-1]
            if first[1]:
                add("trend", f"{_label(n)} went from {_fmt(first[1])} ({first[0]}) to {_fmt(last[1])} ({last[0]}), {_pct((last[1] / first[1] - 1) * 100)}.")
            prev = series[-2]
            if prev[1] and len(series) > 2:
                add("latest_change", f"Latest period ({last[0]}) is {_pct((last[1] / prev[1] - 1) * 100)} vs the previous one ({_fmt(prev[1])}).")
            peak = max(series, key=lambda s: s[1])
            if peak is not last and peak is not first:
                add("peak", f"Peak {_label(n)} was {_fmt(peak[1])} on {peak[0]}.")

    # --- who contributes most --------------------------------------------------------
    elif cats and nums:
        c, n = cats[0], nums[0]
        pairs = [(str(r[c]), float(r[n])) for r in rows if r.get(c) is not None and isinstance(r.get(n), (int, float))]
        if len({k for k, _ in pairs}) != len(pairs):
            pairs = []  # repeated categories: a second dimension exists, so per-category facts would be wrong
        if pairs and _additive(n):
            total = sum(v for _, v in pairs)
            ranked = sorted(pairs, key=lambda p: p[1], reverse=True)
            if total > 0:
                top = ranked[0]
                add("top", f"{top[0]} is the largest {_label(c)} with {_fmt(top[1])} {_label(n)} ({top[1] / total * 100:.0f}% of the {_fmt(total)} total).")
                if len(ranked) > 5:
                    share = sum(v for _, v in ranked[:3]) / total * 100
                    add("concentration", f"The top 3 {_label(c)} values account for {share:.0f}% of the total.")
                add("bottom", f"{ranked[-1][0]} is the smallest at {_fmt(ranked[-1][1])}.")
        elif pairs:
            ranked = sorted(pairs, key=lambda p: p[1], reverse=True)
            add("range", f"{_label(n)} ranges from {_fmt(ranked[-1][1])} ({ranked[-1][0]}) to {_fmt(ranked[0][1])} ({ranked[0][0]}).")

    # --- outliers (IQR) --------------------------------------------------------------
    for n in nums[:1]:
        vals = sorted(values(n))
        if len(vals) >= 8:
            q1, q3 = _quantile(vals, 0.25), _quantile(vals, 0.75)
            iqr = q3 - q1
            if iqr > 0:
                hi, lo = q3 + 1.5 * iqr, q1 - 1.5 * iqr
                odd = [v for v in vals if v > hi or v < lo]
                if odd:
                    add("outliers", f"{len(odd)} outlier value(s) in {_label(n)} (e.g. {_fmt(max(odd, key=lambda v: abs(v - (q1 + q3) / 2)))}), outside {_fmt(lo)}-{_fmt(hi)}.")

    # --- data quality ----------------------------------------------------------------
    for col in columns:
        nulls = sum(1 for r in rows if r.get(col["name"]) is None)
        if nulls / len(rows) > 0.3:
            add("nulls", f"{_label(col['name'])} is empty in {nulls / len(rows) * 100:.0f}% of rows.")

    return out[:MAX_INSIGHTS]
