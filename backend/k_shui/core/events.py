"""In-process async pub/sub bus used for SSE fan-out."""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator
from typing import Any

from k_shui.core.logging import get_logger

log = get_logger(__name__)

MAX_QUEUE = 512


class Event(dict):
    """`{type, clusterId, ts, payload}`."""


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._recent: list[Event] = []

    def subscribe(self) -> asyncio.Queue[Event]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=MAX_QUEUE)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[Event]) -> None:
        self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def recent(self, limit: int = 50) -> list[Event]:
        return self._recent[-limit:]

    def publish(self, type: str, cluster_id: str | None = None, payload: Any = None) -> Event:
        evt = Event(type=type, clusterId=cluster_id, ts=int(time.time() * 1000), payload=payload or {})
        self._recent.append(evt)
        if len(self._recent) > 200:
            del self._recent[:-200]
        for q in list(self._subscribers):
            try:
                q.put_nowait(evt)
            except asyncio.QueueFull:
                log.warning("event.queue_full", type=type)
        return evt

    async def stream(
        self, types: set[str] | None = None, cluster_id: str | None = None
    ) -> AsyncIterator[Event]:
        """Yield events forever; caller is responsible for cancellation."""
        q = self.subscribe()
        try:
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=20.0)
                except TimeoutError:
                    yield Event(type="ping", clusterId=None, ts=int(time.time() * 1000), payload={})
                    continue
                if types and evt["type"] not in types:
                    continue
                if cluster_id and evt.get("clusterId") not in (None, cluster_id):
                    continue
                yield evt
        finally:
            self.unsubscribe(q)


_bus: EventBus | None = None


def get_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus


def publish(type: str, cluster_id: str | None = None, payload: Any = None) -> Event:
    return get_bus().publish(type, cluster_id, payload)


@contextlib.asynccontextmanager
async def bus_lifespan() -> AsyncIterator[EventBus]:
    bus = get_bus()
    try:
        yield bus
    finally:
        bus._subscribers.clear()
