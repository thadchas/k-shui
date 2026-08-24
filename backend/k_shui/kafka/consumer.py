"""Message browsing: bounded, filtered reads with a hard time budget.

Uses a throwaway ``confluent_kafka.Consumer`` with a random group id, auto-commit off and
explicit ``assign()`` (never ``subscribe()``), polled from a worker thread.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import random
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from k_shui.core.errors import BadRequest, NotFound
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext
from k_shui.kafka.admin import KafkaAdmin, client_config
from k_shui.kafka.serdes.auto import SerdeFactory

log = get_logger(__name__)

DEFAULT_TIME_BUDGET = 15.0
DEFAULT_MAX_SCANNED = 200_000
POLL_BATCH = 500


@dataclass(slots=True)
class BrowseRequest:
    topic: str
    mode: str = "latest"  # latest | earliest | offset | timestamp
    partitions: list[int] | None = None
    offset: int | None = None
    start_offsets: dict[int, int] | None = None  # per-partition override for mode=offset
    timestamp: int | None = None
    limit: int = 100
    key_format: str = "auto"
    value_format: str = "auto"
    filter: str | None = None
    filter_mode: str = "contains"  # contains | regex | jsonpath
    time_budget: float = DEFAULT_TIME_BUDGET
    max_scanned: int = DEFAULT_MAX_SCANNED
    include_raw: bool = False

    def __post_init__(self) -> None:
        if self.mode not in ("latest", "earliest", "offset", "timestamp"):
            raise BadRequest(f"unknown mode '{self.mode}'")
        if self.filter_mode not in ("contains", "regex", "jsonpath"):
            raise BadRequest(f"unknown filterMode '{self.filter_mode}'")
        self.limit = max(1, min(int(self.limit), 10_000))


@dataclass(slots=True)
class BrowseState:
    scanned: int = 0
    matched: int = 0
    done: bool = False
    truncated: bool = False
    assignments: list[dict[str, Any]] = field(default_factory=list)


class MessageFilter:
    """contains / regex / jsonpath predicate over key, value and headers."""

    def __init__(self, expression: str | None, mode: str = "contains") -> None:
        self.expression = expression
        self.mode = mode
        self._regex: re.Pattern[str] | None = None
        self._jsonpath: Any = None
        if not expression:
            return
        if mode == "regex":
            try:
                self._regex = re.compile(expression)
            except re.error as exc:
                raise BadRequest(f"invalid regex filter: {exc}") from exc
        elif mode == "jsonpath":
            try:
                from jsonpath_ng.ext import parse as jsonpath_parse

                self._jsonpath = jsonpath_parse(expression)
            except Exception as exc:
                raise BadRequest(f"invalid jsonpath filter: {exc}") from exc

    def matches(self, message: dict[str, Any]) -> bool:
        if not self.expression:
            return True
        if self._jsonpath is not None:
            for candidate in (message.get("value"), message.get("key")):
                if not isinstance(candidate, dict | list):
                    continue
                # try the document itself and wrapped in a list, so root filters
                # like `$[?(@.region=='emea')]` work on single objects too
                for doc in (candidate, [candidate]):
                    with contextlib.suppress(Exception):
                        if self._jsonpath.find(doc):
                            return True
            return False
        haystack = _searchable(message)
        if self._regex is not None:
            return bool(self._regex.search(haystack))
        return self.expression.lower() in haystack.lower()


def _searchable(message: dict[str, Any]) -> str:
    import orjson

    parts = []
    for key in ("key", "value", "headers"):
        v = message.get(key)
        if v is None:
            continue
        parts.append(v if isinstance(v, str) else orjson.dumps(v).decode("utf-8", "replace"))
    return "\n".join(parts)


class MessageBrowser:
    def __init__(self, ctx: ClusterContext) -> None:
        self.ctx = ctx
        self.admin = KafkaAdmin.get(ctx)
        self.serdes = SerdeFactory.get(ctx)

    @classmethod
    def from_context(cls, ctx: ClusterContext) -> MessageBrowser:
        return cls(ctx)

    @staticmethod
    def get(ctx: ClusterContext) -> MessageBrowser:
        return ctx.client("message_browser", MessageBrowser.from_context)

    # ------------------------------------------------------------------ planning
    async def _plan(self, req: BrowseRequest) -> list[tuple[int, int, int]]:
        """→ [(partition, startOffset, endOffset)] honouring the browse mode."""
        detail = await self.admin.describe_topic(req.topic)
        available = [p["id"] for p in detail["partitionsDetail"]]
        if not available:
            raise NotFound(f"topic '{req.topic}' has no partitions")
        wanted = [p for p in (req.partitions or available) if p in available]
        if not wanted:
            raise BadRequest(f"none of the requested partitions exist on topic '{req.topic}'")
        marks = await self.admin.watermarks([(req.topic, p) for p in wanted])
        per_partition = max(1, req.limit // len(wanted) + 1)
        ts_offsets: dict[tuple[str, int], int] = {}
        if req.mode == "timestamp":
            if req.timestamp is None:
                raise BadRequest("mode=timestamp requires a timestamp")
            ts_offsets = await self.admin.offsets_for_times(
                [(req.topic, p, int(req.timestamp)) for p in wanted]
            )

        plan: list[tuple[int, int, int]] = []
        for part in wanted:
            low, high = marks.get((req.topic, part), (0, 0))
            if high <= low:
                continue
            if req.mode == "earliest":
                start = low
            elif req.mode == "offset":
                wanted_offset = (req.start_offsets or {}).get(part, req.offset)
                if wanted_offset is None:
                    raise BadRequest("mode=offset requires an offset or startOffsets")
                start = max(low, min(int(wanted_offset), high))
            elif req.mode == "timestamp":
                resolved = ts_offsets.get((req.topic, part), -1)
                start = high if resolved < 0 else max(low, resolved)
            else:  # latest
                start = max(low, high - per_partition)
            if start >= high:
                continue
            plan.append((part, start, high))
        return plan

    # ------------------------------------------------------------------ browsing
    async def browse(self, req: BrowseRequest) -> AsyncIterator[dict[str, Any]]:
        """Yield ``{'type': 'message'|'progress'|'end'|'error', ...}`` events."""
        state = BrowseState()
        predicate = MessageFilter(req.filter, req.filter_mode)
        try:
            plan = await self._plan(req)
        except Exception as exc:
            yield {"type": "error", "error": str(exc)}
            return
        state.assignments = [{"partition": p, "startOffset": s, "endOffset": e} for p, s, e in plan]
        if not plan:
            yield {"type": "progress", "scanned": 0, "matched": 0, "done": True}
            yield {"type": "end", "scanned": 0, "matched": 0, "assignments": state.assignments}
            return

        consumer = self._make_consumer()  # cimpl objects must be built on the loop thread
        deadline = time.monotonic() + req.time_budget
        remaining = {p: e for p, _s, e in plan}
        try:
            self._assign(consumer, req.topic, plan)
            while state.matched < req.limit and state.scanned < req.max_scanned:
                if time.monotonic() >= deadline:
                    state.truncated = True
                    break
                raw = await asyncio.to_thread(self._poll, consumer, min(POLL_BATCH, req.limit * 4), 0.8)
                if not raw:
                    if not remaining:
                        break
                    if time.monotonic() >= deadline:
                        state.truncated = True
                        break
                    continue
                for msg in raw:
                    state.scanned += 1
                    if msg.offset() + 1 >= remaining.get(msg.partition(), 0):
                        remaining.pop(msg.partition(), None)
                    decoded = await self._decode(msg, req)
                    if not predicate.matches(decoded):
                        continue
                    state.matched += 1
                    yield {"type": "message", "message": decoded}
                    if state.matched >= req.limit:
                        break
                yield {"type": "progress", "scanned": state.scanned, "matched": state.matched, "done": False}
                if not remaining:
                    break
            state.done = True
            yield {
                "type": "end",
                "scanned": state.scanned,
                "matched": state.matched,
                "truncated": state.truncated,
                "assignments": state.assignments,
            }
        finally:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(consumer.close)

    async def collect(self, req: BrowseRequest) -> dict[str, Any]:
        """Non-streaming variant → ``{items, scanned, matched, truncated, assignments}``."""
        items: list[dict[str, Any]] = []
        summary: dict[str, Any] = {"scanned": 0, "matched": 0, "truncated": False, "assignments": []}
        async for event in self.browse(req):
            if event["type"] == "message":
                items.append(event["message"])
            elif event["type"] == "end":
                summary.update({k: v for k, v in event.items() if k != "type"})
            elif event["type"] == "error":
                raise BadRequest(event["error"])
        items.sort(key=lambda m: (m["partition"], m["offset"]))
        return {"items": items, **summary}

    # ------------------------------------------------------------------ internals
    def _make_consumer(self) -> Any:
        from confluent_kafka import Consumer

        cfg = client_config(
            self.ctx,
            {
                "group.id": f"k-shui-browse-{random.randint(0, 1 << 40)}",
                "enable.auto.commit": False,
                "auto.offset.reset": "earliest",
                "enable.partition.eof": True,
                "fetch.wait.max.ms": 200,
                "session.timeout.ms": 10000,
            },
        )
        return Consumer(cfg)

    @staticmethod
    def _assign(consumer: Any, topic: str, plan: list[tuple[int, int, int]]) -> None:
        from confluent_kafka import TopicPartition

        consumer.assign([TopicPartition(topic, part, start) for part, start, _end in plan])

    @staticmethod
    def _poll(consumer: Any, batch: int, timeout: float) -> list[Any]:
        messages = consumer.consume(num_messages=max(1, batch), timeout=timeout) or []
        out = []
        for m in messages:
            err = m.error()
            if err is not None:
                if err.code() == err._PARTITION_EOF:
                    continue
                log.debug("browse.message_error", error=str(err))
                continue
            out.append(m)
        return out

    async def _decode(self, msg: Any, req: BrowseRequest) -> dict[str, Any]:
        key_bytes, value_bytes = msg.key(), msg.value()
        key, key_format, key_schema = await self.serdes.deserialize(
            req.key_format, key_bytes, req.topic, True
        )
        value, value_format, value_schema = await self.serdes.deserialize(
            req.value_format, value_bytes, req.topic, False
        )
        ts_type, ts = msg.timestamp()
        headers: dict[str, Any] = {}
        for name, raw in msg.headers() or []:
            headers[name] = raw.decode("utf-8", "replace") if isinstance(raw, bytes | bytearray) else raw
        out: dict[str, Any] = {
            "partition": msg.partition(),
            "offset": msg.offset(),
            "timestamp": ts,
            "timestampType": {0: "notAvailable", 1: "createTime", 2: "logAppendTime"}.get(
                ts_type, "notAvailable"
            ),
            "key": key,
            "keyFormat": key_format,
            "value": value,
            "valueFormat": value_format,
            "headers": headers,
            "keySchemaId": key_schema,
            "valueSchemaId": value_schema,
            "sizeBytes": len(key_bytes or b"") + len(value_bytes or b""),
        }
        if req.include_raw:
            out["keyRaw"] = base64.b64encode(key_bytes).decode("ascii") if key_bytes else None
            out["valueRaw"] = base64.b64encode(value_bytes).decode("ascii") if value_bytes else None
        return out


__all__ = ["BrowseRequest", "MessageBrowser", "MessageFilter"]
