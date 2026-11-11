from utils.insights import compute_insights

NUM = {"name": "ORDER_COUNT", "type": "number"}


def kinds(ins):
    return {i["kind"] for i in ins}


def test_single_row_has_no_insights():
    assert compute_insights([{"N": 1}], [{"name": "N", "type": "number"}]) == []


def test_trend_latest_change_and_peak():
    rows = [{"M": f"2023-0{i}-01", "ORDER_COUNT": v} for i, v in enumerate([100, 150, 300, 200], start=1)]
    ins = compute_insights(rows, [{"name": "M", "type": "date"}, NUM])
    assert kinds(ins) >= {"trend", "latest_change", "peak"}
    trend = next(i for i in ins if i["kind"] == "trend")["text"]
    assert "100" in trend and "200" in trend and "+100.0%" in trend
    assert "-33.3%" in next(i for i in ins if i["kind"] == "latest_change")["text"]
    assert "300" in next(i for i in ins if i["kind"] == "peak")["text"]


def test_top_contributor_share_for_additive_column():
    rows = [{"STATUS": "a", "ORDER_COUNT": 60}, {"STATUS": "b", "ORDER_COUNT": 30}, {"STATUS": "c", "ORDER_COUNT": 10}]
    ins = compute_insights(rows, [{"name": "STATUS", "type": "string"}, NUM])
    top = next(i for i in ins if i["kind"] == "top")["text"]
    assert top.startswith("a ") and "60%" in top and "100 total" in top


def test_non_additive_column_gets_range_not_share():
    rows = [{"G": "F", "AVG_AGE": 40.0}, {"G": "M", "AVG_AGE": 42.0}]
    ins = compute_insights(rows, [{"name": "G", "type": "string"}, {"name": "AVG_AGE", "type": "number"}])
    assert kinds(ins) == {"range"}


def test_outliers_detected():
    rows = [{"ID": str(i), "ORDER_COUNT": v} for i, v in enumerate([10, 11, 12, 10, 11, 12, 11, 10, 500])]
    ins = compute_insights(rows, [{"name": "ID", "type": "string"}, NUM])
    assert "outliers" in kinds(ins)


def test_null_heavy_column_flagged():
    rows = [{"A": None, "ORDER_COUNT": 1}, {"A": None, "ORDER_COUNT": 2}, {"A": "x", "ORDER_COUNT": 3}]
    ins = compute_insights(rows, [{"name": "A", "type": "string"}, NUM])
    assert "nulls" in kinds(ins)


def test_capped():
    rows = [{"M": f"2023-{i:02d}-01", "ORDER_COUNT": i * i, "X": None} for i in range(1, 12)]
    ins = compute_insights(rows, [{"name": "M", "type": "date"}, NUM, {"name": "X", "type": "string"}])
    assert len(ins) <= 5


def test_id_and_index_columns_are_not_metrics():
    rows = [{"ID": i, "NAME": f"dc{i}"} for i in range(1, 6)]
    assert compute_insights(rows, [{"name": "ID", "type": "number"}, {"name": "NAME", "type": "string"}]) == []
    rows = [{"MONTHS_SINCE_SIGNUP": i, "D": "2024-01-01"} for i in range(5)]
    cols = [{"name": "MONTHS_SINCE_SIGNUP", "type": "number"}, {"name": "D", "type": "date"}]
    assert compute_insights(rows, cols) == []


def test_repeated_dates_skip_trend():
    # cohort-style data: the same date appears for several periods
    rows = [{"COHORT": "2024-01-01", "PCT": p} for p in (10, 20, 30)]
    cols = [{"name": "COHORT", "type": "date"}, {"name": "PCT", "type": "number"}]
    assert "trend" not in kinds(compute_insights(rows, cols))


def test_repeated_categories_skip_top_contributor():
    rows = [{"S": "a", "ORDER_COUNT": 5}, {"S": "a", "ORDER_COUNT": 7}, {"S": "b", "ORDER_COUNT": 1}]
    assert "top" not in kinds(compute_insights(rows, [{"name": "S", "type": "string"}, NUM]))
