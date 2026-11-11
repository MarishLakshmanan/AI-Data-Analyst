import pytest

from utils.sql_guardrail import SQLValidationError, validate_sql

ALLOWED = {"ORDERS", "USERS", "PRODUCTS", "ORDER_ITEMS"}


def ok(sql: str) -> str:
    return validate_sql(sql, ALLOWED)


def test_plain_select_passes_and_is_cleaned():
    assert ok("```sql\nSELECT 1 FROM LOOKER.AI.ORDERS;\n```") == "SELECT 1 FROM LOOKER.AI.ORDERS"


def test_cte_names_are_not_treated_as_unknown_tables():
    ok("WITH t AS (SELECT * FROM ORDERS) SELECT * FROM t")


def test_union_allowed():
    ok("SELECT ORDER_ID FROM ORDERS UNION ALL SELECT ORDER_ID FROM ORDERS")


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE ORDERS",
        "DELETE FROM ORDERS",
        "UPDATE ORDERS SET STATUS = 'x'",
        "INSERT INTO ORDERS VALUES (1)",
        "CREATE TABLE x AS SELECT 1",
        "TRUNCATE TABLE ORDERS",
    ],
)
def test_write_statements_rejected(sql):
    with pytest.raises(SQLValidationError):
        ok(sql)


def test_multiple_statements_rejected():
    with pytest.raises(SQLValidationError, match="Exactly one"):
        ok("SELECT 1 FROM ORDERS; SELECT 2 FROM ORDERS")


def test_empty_rejected():
    with pytest.raises(SQLValidationError, match="empty"):
        ok("  ;  ")


def test_unknown_table_rejected():
    with pytest.raises(SQLValidationError, match="Unknown table"):
        ok("SELECT * FROM SECRETS")


def test_wrong_schema_rejected():
    with pytest.raises(SQLValidationError, match="Schema"):
        ok("SELECT * FROM OTHER.ORDERS")


def test_syntax_error_rejected():
    with pytest.raises(SQLValidationError):
        ok("SELECT FROM WHERE")


# ---- PII ---------------------------------------------------------------
PII = {"USERS": {"EMAIL", "FIRST_NAME"}, "EVENTS": {"IP_ADDRESS"}}
ALLOWED_PII = ALLOWED | {"EVENTS"}


def pii_ok(sql: str) -> str:
    return validate_sql(sql, ALLOWED_PII, PII)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(EMAIL) FROM USERS",
        "SELECT COUNT(DISTINCT EMAIL) FROM USERS",
        "SELECT ID FROM USERS WHERE EMAIL LIKE '%@gmail.com'",
        "SELECT u.ID, COUNT(*) FROM USERS u JOIN ORDERS o ON o.USER_ID = u.ID GROUP BY u.ID",
        "SELECT o.* FROM ORDERS o JOIN USERS u ON u.ID = o.USER_ID",
        "SELECT * FROM ORDERS",
        "SELECT COUNT(*) FROM USERS",
    ],
)
def test_pii_safe_usage_allowed(sql):
    pii_ok(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT EMAIL FROM USERS",
        "SELECT u.first_name AS n FROM USERS u",
        "SELECT UPPER(EMAIL) FROM USERS",
        "SELECT MAX(EMAIL) FROM USERS",
        "SELECT ID FROM USERS GROUP BY ID, EMAIL",
        "SELECT ID FROM USERS ORDER BY EMAIL",
        "SELECT * FROM USERS",
        "SELECT u.* FROM USERS u",
        "SELECT * FROM ORDERS o JOIN USERS u ON u.ID = o.USER_ID",
        "SELECT IP_ADDRESS FROM EVENTS",
        "WITH t AS (SELECT EMAIL FROM USERS) SELECT COUNT(*) FROM t",
        "SELECT ID FROM USERS WHERE ID IN (SELECT EMAIL FROM USERS)",
    ],
)
def test_pii_leaks_rejected(sql):
    with pytest.raises(SQLValidationError, match="PII"):
        pii_ok(sql)
