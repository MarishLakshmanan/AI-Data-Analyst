import datetime as dt
from decimal import Decimal

from fastapi.testclient import TestClient

from app.main import _jsonable, app


def test_jsonable_converts_and_infers_types():
    rows = [{"N": Decimal("1.5"), "D": dt.date(2023, 1, 2), "S": "x", "B": True, "Z": None}]
    clean, cols = _jsonable(rows)
    assert clean == [{"N": 1.5, "D": "2023-01-02", "S": "x", "B": True, "Z": None}]
    assert {c.name: c.type for c in cols} == {
        "N": "number", "D": "date", "S": "string", "B": "boolean", "Z": "string",
    }


def test_jsonable_uses_first_non_null_value_for_type():
    _, cols = _jsonable([{"N": None}, {"N": 3}])
    assert cols[0].type == "number"


def test_jsonable_empty():
    assert _jsonable([]) == ([], [])


def test_execute_rejects_writes_before_touching_snowflake():
    r = TestClient(app).post("/execute", json={"sql": "DROP TABLE ORDERS"})
    assert r.status_code == 400
    assert "guardrail" in r.json()["detail"]


def test_build_prompt_includes_previous_sql_for_followups():
    from app.AI.sql_agent import build_prompt

    assert build_prompt("q") == "q"
    p = build_prompt("only 2024", {"question": "orders by status", "sql": "SELECT 1"})
    assert "SELECT 1" in p and "orders by status" in p and "only 2024" in p
