"""Shared FastAPI dependencies: pagination and time-range parsing."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar

from fastapi import Query

from k_shui.core.errors import BadRequest

T = TypeVar("T")

RANGE_SECONDS: dict[str, int] = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "3h": 10800,
    "6h": 21600,
    "12h": 43200,
    "24h": 86400,
    "2d": 172800,
    "7d": 604800,
    "30d": 2592000,
}


@dataclass(slots=True)
class Pagination:
    page: int = 1
    per_page: int = 50

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.per_page

    def slice(self, items: list[T]) -> list[T]:
        return items[self.offset : self.offset + self.per_page]

    def envelope(self, items: list[Any], total: int | None = None) -> dict[str, Any]:
        """Paginate an in-memory list into the standard `{items, page, perPage, total}` shape."""
        return {
            "items": self.slice(items) if total is None else items,
            "page": self.page,
            "perPage": self.per_page,
            "total": len(items) if total is None else total,
        }


def pagination(
    page: int = Query(1, ge=1, description="1-based page number"),
    perPage: int = Query(50, ge=1, le=1000, alias="perPage", description="items per page"),
) -> Pagination:
    return Pagination(page=page, per_page=perPage)


def _parse_ts(raw: str) -> float:
    """Accept epoch seconds, epoch millis or ISO-8601."""
    try:
        val = float(raw)
        return val / 1000.0 if val > 1e11 else val
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise BadRequest(f"cannot parse timestamp '{raw}'") from exc


@dataclass(slots=True)
class TimeRange:
    start: float  # epoch seconds
    end: float
    step: float  # seconds
    label: str = "1h"

    @property
    def duration(self) -> float:
        return max(self.end - self.start, 1.0)

    @property
    def start_ms(self) -> int:
        return int(self.start * 1000)

    @property
    def end_ms(self) -> int:
        return int(self.end * 1000)

    def buckets(self) -> list[float]:
        out: list[float] = []
        t = self.start
        while t <= self.end and len(out) < 5000:
            out.append(t)
            t += self.step
        return out


def _auto_step(duration: float) -> float:
    # aim for ~120 points
    for candidate in (15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400):
        if duration / candidate <= 240:
            return float(candidate)
    return 86400.0


def time_range(
    range: str | None = Query(None, description="1h|6h|24h|7d …; ignored when start/end given"),
    start: str | None = Query(None, description="epoch seconds/millis or ISO-8601"),
    end: str | None = Query(None),
    step: str | None = Query(None, description="step in seconds, or 30s/5m/1h"),
) -> TimeRange:
    now = time.time()
    if start:
        s = _parse_ts(start)
        e = _parse_ts(end) if end else now
        label = range or "custom"
    else:
        label = range or "1h"
        seconds = RANGE_SECONDS.get(label)
        if seconds is None:
            seconds = _parse_duration(label)
        e = now
        s = e - seconds
    if e <= s:
        raise BadRequest("end must be after start")
    st = _parse_duration(step) if step else _auto_step(e - s)
    return TimeRange(start=s, end=e, step=max(st, 1.0), label=label)


def _parse_duration(raw: str) -> float:
    raw = raw.strip()
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
    if raw and raw[-1] in units:
        try:
            return float(raw[:-1]) * units[raw[-1]]
        except ValueError as exc:
            raise BadRequest(f"cannot parse duration '{raw}'") from exc
    try:
        return float(raw)
    except ValueError as exc:
        raise BadRequest(f"cannot parse duration '{raw}'") from exc


def iso(ts_seconds: float) -> str:
    return datetime.fromtimestamp(ts_seconds, tz=UTC).isoformat()


def series(name: str, points: list[list[float]], labels: dict[str, str] | None = None) -> dict[str, Any]:
    """Build one entry of the standard `{series:[{name, labels, points:[[tsMs, value]]}]}` shape."""
    return {"name": name, "labels": labels or {}, "points": points}


__all__ = ["Pagination", "TimeRange", "iso", "pagination", "series", "time_range"]
