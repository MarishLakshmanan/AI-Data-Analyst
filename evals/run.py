"""Live eval: run the SQL agent on golden questions and compare RESULT SETS to the
reference SQL. Needs OpenRouter + Snowflake credentials.

    uv run python -m evals.run [--tag join] [--id total_orders] [--limit 5] [--concurrency 4]
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from app.AI.sql_agent import Clarification, _build_context, agent, build_prompt
from evals.compare import compare, norm
from utils.snowflake_db import run_query

ROOT = Path(__file__).parent
MAX_ROWS = 2000


def as_rows(rows: list[dict[str, Any]]) -> list[tuple]:
    return [tuple(norm(v) for v in r.values()) for r in rows]


def task(inputs: dict[str, Any]) -> dict[str, Any]:
    """Run the agent for one question, execute its SQL and compare with the reference."""
    start = time.perf_counter()
    out: dict[str, Any] = {"sql": None, "match": False, "reason": "", "requests": 0, "tokens": 0}
    try:
        res = agent.run_sync(build_prompt(inputs["question"], inputs.get("previous")), deps=_build_context())
        usage = res.usage()
        out.update(requests=usage.requests, tokens=usage.total_tokens or 0)
        if isinstance(res.output, Clarification):
            out["kind"] = "clarification"
            out["match"] = inputs["expect"] == "clarification"
            out["reason"] = "ok" if out["match"] else "unexpected clarification: " + res.output.question[:100]
            out["latency_s"] = round(time.perf_counter() - start, 1)
            return out
        out["kind"] = "sql"
        out["sql"] = res.output.sql
        if inputs["expect"] == "clarification":
            out["reason"] = "expected a clarification but got SQL: " + res.output.sql.replace("\n", " ")[:100]
            out["latency_s"] = round(time.perf_counter() - start, 1)
            return out
        actual = as_rows(run_query(res.output.sql, max_rows=MAX_ROWS))
        out["match"], out["reason"] = compare(
            actual, inputs["expected"], ordered=inputs["ordered"], tol=inputs["tol"]
        )
    except UnexpectedModelBehavior as e:
        out["reason"] = f"agent gave up after retries: {str(e)[:160]}"
    except Exception as e:  # noqa: BLE001 - report any failure as a failed case
        out["reason"] = f"{type(e).__name__}: {str(e)[:160]}"
    out["latency_s"] = round(time.perf_counter() - start, 1)
    return out


@dataclass
class ResultMatches(Evaluator[dict, dict, dict]):
    def evaluate(self, ctx: EvaluatorContext[dict, dict, dict]) -> bool:
        return bool(ctx.output["match"])


def load_cases(args: argparse.Namespace) -> list[Case]:
    raw = yaml.safe_load((ROOT / "golden.yaml").read_text())["cases"]
    raw = [c for c in raw if (not args.tag or args.tag in c.get("tags", [])) and (not args.id or c["id"] in args.id)]
    if args.limit:
        raw = raw[: args.limit]
    cases = []
    for c in raw:
        expect = c.get("expect", "result")
        expected = as_rows(run_query(c["reference_sql"], max_rows=MAX_ROWS)) if expect == "result" else []
        inputs = {
            "question": c["question"],
            "previous": c.get("previous"),
            "expect": expect,
            "expected": expected,
            "ordered": c.get("ordered", False),
            "tol": c.get("tol", 1e-3),
        }
        cases.append(Case(name=c["id"], inputs=inputs, metadata={"tags": c.get("tags", [])}))
    return cases


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag")
    ap.add_argument("--id", action="append")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()

    cases = load_cases(args)
    if not cases:
        raise SystemExit("No cases selected.")
    dataset = Dataset(name="golden", cases=cases, evaluators=[ResultMatches()])
    report = dataset.evaluate_sync(task, max_concurrency=args.concurrency, progress=False)

    rows = [{"id": c.name, **c.output} for c in report.cases]
    for r in rows:
        print(f"{'PASS' if r['match'] else 'FAIL'}  {r['id']:28} {r['latency_s']:5.1f}s  req={r['requests']}  {'' if r['match'] else r['reason']}")
    n = len(rows)
    ok = sum(r["match"] for r in rows)
    summary = {
        "execution_accuracy": round(ok / n, 3),
        "passed": ok,
        "total": n,
        "avg_requests": round(sum(r["requests"] for r in rows) / n, 2),
        "avg_latency_s": round(sum(r["latency_s"] for r in rows) / n, 1),
        "total_tokens": sum(r["tokens"] for r in rows),
    }
    print("\n" + json.dumps(summary))
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    path = out / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    path.write_text(json.dumps({"summary": summary, "cases": rows}, indent=2, default=str))
    print(f"report: {path}")


if __name__ == "__main__":
    main()
