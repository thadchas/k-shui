"""Tiny in-memory fallbacks used when the database is unavailable.

Everything here is process-local and intentionally bounded, so a long-running instance
without a database never grows without limit.
"""

from __future__ import annotations

import itertools
import time
from collections import deque
from typing import Any

_ids = itertools.count(1)


def next_id(prefix: str) -> str:
    return f"{prefix}-{next(_ids)}-{int(time.time() * 1000) % 100000}"


class Ring:
    """Bounded append-only ring buffer with newest-first reads."""

    def __init__(self, maxlen: int = 500) -> None:
        self._items: deque[dict[str, Any]] = deque(maxlen=maxlen)

    def add(self, item: dict[str, Any]) -> dict[str, Any]:
        self._items.append(item)
        return item

    def all(self) -> list[dict[str, Any]]:
        return list(reversed(self._items))

    def clear(self) -> None:
        self._items.clear()

    def __len__(self) -> int:
        return len(self._items)


class Table:
    """Dict-backed table of ``{id: row}`` with insertion order preserved."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def list(self) -> list[dict[str, Any]]:
        return list(self.rows.values())

    def get(self, row_id: str) -> dict[str, Any] | None:
        return self.rows.get(row_id)

    def put(self, row: dict[str, Any]) -> dict[str, Any]:
        self.rows[str(row["id"])] = row
        return row

    def delete(self, row_id: str) -> bool:
        return self.rows.pop(row_id, None) is not None

    def clear(self) -> None:
        self.rows.clear()


# ksql statement history, keyed by "clusterId/serverName"
ksql_history: dict[str, Ring] = {}
# OpenLineage events received while no Marquez is configured
openlineage_events = Ring(maxlen=1000)
# user dashboards keyed by cluster id
user_dashboards: dict[str, Table] = {}


def ksql_ring(key: str) -> Ring:
    return ksql_history.setdefault(key, Ring(maxlen=200))


def dashboard_table(cluster_id: str) -> Table:
    return user_dashboards.setdefault(cluster_id, Table())
