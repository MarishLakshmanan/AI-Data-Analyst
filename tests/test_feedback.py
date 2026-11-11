import pytest
from fastapi.testclient import TestClient

from app.main import app
from scripts.review_feedback import append_golden_case, promote
from utils import app_db
from utils.semantic_model import load_semantic_model
from utils.sql_guardrail import SQLValidationError


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "app.db"
    monkeypatch.setenv("APP_DB_PATH", str(path))
    return path


def test_feedback_roundtrip(db):
    fid = app_db.add_feedback("q", "SELECT 1", "up", ["a1"], "nice")
    rows = app_db.list_feedback("up")
    assert rows[0]["id"] == fid and rows[0]["assumptions"] == ["a1"] and rows[0]["promoted"] == 0
    assert app_db.list_feedback("down") == []


def test_list_verified_does_not_create_the_db_file(db):
    assert app_db.list_verified() == [] and not db.exists()


def test_bad_rating_rejected_by_api(db):
    r = TestClient(app).post("/feedback", json={"question": "q", "sql": "SELECT 1", "rating": "meh"})
    assert r.status_code == 422


def test_feedback_endpoint_stores(db):
    r = TestClient(app).post("/feedback", json={"question": "q", "sql": "SELECT 1", "rating": "down", "comment": "wrong"})
    assert r.status_code == 200
    assert app_db.list_feedback("down")[0]["comment"] == "wrong"


def test_promote_validates_then_writes_everything(db, tmp_path):
    golden = tmp_path / "golden.yaml"
    golden.write_text("cases:\n")
    sql = "SELECT STATUS, COUNT(*) AS N FROM LOOKER.AI.ORDERS GROUP BY STATUS"
    fid = app_db.add_feedback("Orders per status?", sql, "up")
    dup = app_db.add_feedback("Orders per status?", sql, "up")  # duplicate vote

    case_id = promote(app_db.list_feedback("up")[0], explain=False, golden_path=golden)

    assert case_id.startswith(f"fb_{fid}_")
    assert [v["question"] for v in app_db.list_verified()] == ["Orders per status?"]
    assert {r["id"] for r in app_db.list_feedback("up", only_unpromoted=True)} == set()  # dup retired too
    assert dup  # silence unused
    assert "Orders per status?" in golden.read_text() and "reference_sql" in golden.read_text()
    # the agent prompt now sees it
    questions = [q["question"] for q in load_semantic_model()["verified_queries"]]
    assert "Orders per status?" in questions
    assert "Orders per status?" not in [q["question"] for q in load_semantic_model(include_approved=False)["verified_queries"]]


def test_promote_refuses_unsafe_or_pii_sql_and_writes_nothing(db, tmp_path):
    golden = tmp_path / "golden.yaml"
    golden.write_text("cases:\n")
    for sql in ("DROP TABLE LOOKER.AI.ORDERS", "SELECT EMAIL FROM LOOKER.AI.USERS"):
        app_db.add_feedback("bad", sql, "up")
        with pytest.raises(SQLValidationError):
            promote(app_db.list_feedback("up")[-1], explain=False, golden_path=golden)
    assert app_db.list_verified() == [] and golden.read_text() == "cases:\n"


def test_edited_sql_is_what_gets_approved(db, tmp_path):
    golden = tmp_path / "golden.yaml"
    golden.write_text("cases:\n")
    app_db.add_feedback("count orders", "SELECT COUNT(*) FROM LOOKER.AI.ORDERS", "up")
    promote(app_db.list_feedback("up")[0], "SELECT COUNT(DISTINCT ORDER_ID) FROM LOOKER.AI.ORDERS;", explain=False, golden_path=golden)
    assert app_db.list_verified()[0]["sql"] == "SELECT COUNT(DISTINCT ORDER_ID) FROM LOOKER.AI.ORDERS"  # cleaned


def test_golden_append_is_idempotent_and_valid_yaml(tmp_path):
    import yaml

    g = tmp_path / "g.yaml"
    g.write_text("cases:\n  - id: a\n    question: x\n    reference_sql: SELECT 1\n")
    assert append_golden_case("fb_1", 'Has "quotes": and colons?', "SELECT 1\nFROM T", g)
    assert not append_golden_case("fb_2", 'Has "quotes": and colons?', "SELECT 1", g)
    cases = yaml.safe_load(g.read_text())["cases"]
    assert [c["id"] for c in cases] == ["a", "fb_1"]
    assert cases[1]["question"] == 'Has "quotes": and colons?' and cases[1]["reference_sql"].startswith("SELECT 1\nFROM T")
