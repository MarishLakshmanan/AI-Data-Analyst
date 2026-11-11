import datetime as dt
from decimal import Decimal

from evals.compare import compare, norm


def rows(*r):
    return [tuple(norm(v) for v in x) for x in r]


def test_unordered_multiset_match():
    assert compare(rows(("a", 1), ("b", 2)), rows(("b", 2), ("a", 1)))[0]


def test_ordered_respects_order():
    assert not compare(rows(("a", 1), ("b", 2)), rows(("b", 2), ("a", 1)), ordered=True)[0]


def test_decimal_vs_rounded_float_within_tolerance():
    assert compare(rows((Decimal("59.5685435"),)), rows((59.57,)))[0]


def test_wrong_number_fails():
    assert not compare(rows((100,)), rows((101,)))[0]


def test_midnight_datetime_equals_date():
    assert compare(rows((dt.date(2023, 1, 1), 5)), rows((dt.datetime(2023, 1, 1), 5)))[0]


def test_extra_and_reordered_columns_tolerated():
    actual = rows((1, "a", 10), (2, "b", 20))
    expected = rows(("a", 10), ("b", 20))
    assert compare(actual, expected)[0]


def test_missing_column_fails():
    assert not compare(rows(("a",), ("b",)), rows(("a", 10), ("b", 20)))[0]


def test_row_count_mismatch():
    ok, why = compare(rows((1,)), rows((1,), (2,)))
    assert not ok and "row count" in why


def test_empty_vs_empty():
    assert compare([], [])[0]


def test_two_decimal_rounding_is_accepted_but_real_differences_are_not():
    assert compare(rows((2.505174,)), rows((2.51,)))[0]
    assert not compare(rows((2.505174,)), rows((2.6,)))[0]
    assert not compare(rows((1000.0,)), rows((1010.0,)))[0]
