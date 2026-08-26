"""Server-side read-only SQL classification (mirrors the frontend's ``isReadOnlySql``)."""

from __future__ import annotations

import pytest

from k_shui.core.sqlguard import KSQL_READ_ONLY, is_read_only_sql


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("SELECT 1", True),
        ("  select * from t; SHOW TABLES;", True),
        ("-- comment\nWITH x AS (SELECT 1) SELECT * FROM x", True),
        ("/* multi\nline */ DESCRIBE t", True),
        ("", True),
        ("INSERT INTO t SELECT 1", False),
        ("SELECT 1; DROP TABLE t", False),
        ("SELECTX", False),
        ("CREATE TABLE t (a INT)", False),
    ],
)
def test_flink_classification(sql: str, expected: bool) -> None:
    assert is_read_only_sql(sql) is expected


def test_ksql_keywords() -> None:
    assert is_read_only_sql("SHOW STREAMS; LIST TABLES; PRINT 't' LIMIT 1;", KSQL_READ_ONLY)
    assert not is_read_only_sql("WITH x AS (SELECT 1) SELECT 1", KSQL_READ_ONLY)  # ksql has no WITH
    assert not is_read_only_sql("TERMINATE q1;", KSQL_READ_ONLY)
