"""Classify SQL text as read-only so viewers may run queries while mutations need an editor."""

from __future__ import annotations

import re

FLINK_READ_ONLY = ("SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "LIST", "PRINT", "HELP")
KSQL_READ_ONLY = ("SELECT", "SHOW", "LIST", "DESCRIBE", "EXPLAIN", "PRINT")

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def is_read_only_sql(sql: str, keywords: tuple[str, ...] = FLINK_READ_ONLY) -> bool:
    """True when every ``;``-separated statement starts with one of ``keywords`` (comments
    stripped, case-insensitive). Empty input counts as read-only. Mirrors the frontend's
    ``isReadOnlySql`` so the UI and the API agree on who may run what."""
    stripped = _BLOCK_COMMENT.sub("", _LINE_COMMENT.sub("", sql or ""))
    statements = [s.strip() for s in stripped.split(";") if s.strip()]
    head = re.compile(r"^(" + "|".join(keywords) + r")\b", re.IGNORECASE)
    return all(head.match(s) for s in statements)


__all__ = ["FLINK_READ_ONLY", "KSQL_READ_ONLY", "is_read_only_sql"]
