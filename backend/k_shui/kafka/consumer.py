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
TAIL_HEARTBEAT_INTERVAL = 2.0
TAIL_FLUSH_INTERVAL = 0.1  # one poll → one batch flush, never more often than this
BROWSE_MODES = ("latest", "earliest", "offset", "timestamp", "tail")
FILTER_MODES = ("contains", "regex", "jsonpath")
# Regex filters run against every scanned record, so patterns that backtrack catastrophically
# (a quantified group that is itself quantified, or stacked quantifiers) are refused up front
# and the searched text is capped.
NESTED_QUANTIFIER = re.compile(r"\([^)]*[+*]\)\s*[+*{]|[+*]{2}")
MAX_FILTER_HAYSTACK = 64 * 1024
FILTER_TARGETS = ("any", "key", "value", "header")
HEADER_PREFIX = "header:"


@dataclass(slots=True)
class BrowseRequest:
    topic: str
    mode: str = "latest"  # latest | earliest | offset | timestamp | tail
    partitions: list[int] | None = None
    offset: int | None = None
    start_offsets: dict[int, int] | None = None  # per-partition override for mode=offset
    timestamp: int | None = None
    limit: int = 100
    key_format: str = "auto"
    value_format: str = "auto"
    filter: str | None = None
    filter_mode: str = "contains"  # contains | regex | jsonpath
    filter_target: str = "any"  # any | key | value | header
    time_budget: float = DEFAULT_TIME_BUDGET
    max_scanned: int = DEFAULT_MAX_SCANNED
    include_raw: bool = False
    # tail only: how often a progress heartbeat (with end offsets / lag) is emitted
    heartbeat_interval: float = TAIL_HEARTBEAT_INTERVAL

    def __post_init__(self) -> None:
        if self.mode not in BROWSE_MODES:
            raise BadRequest(f"unknown mode '{self.mode}'")
        if self.filter_mode not in FILTER_MODES:
            raise BadRequest(f"unknown filterMode '{self.filter_mode}'")
        if self.filter_target not in FILTER_TARGETS:
            raise BadRequest(f"unknown filterTarget '{self.filter_target}'")
        self.limit = max(1, min(int(self.limit), 10_000))

    @property
    def tail(self) -> bool:
        return self.mode == "tail"


@dataclass(slots=True)
class BrowseState:
    scanned: int = 0
    matched: int = 0
    done: bool = False
    truncated: bool = False
    assignments: list[dict[str, Any]] = field(default_factory=list)


class MessageFilter:
    """contains / regex / jsonpath predicate over key, value and/or headers.

    ``target`` scopes the haystack (``any`` = key + value + headers). A ``header:<name>=<value>``
    expression (or ``target="header"``) matches a single header by name; the value part is a
    substring (contains) or pattern (regex) and may be omitted to test for presence only.
    """

    def __init__(self, expression: str | None, mode: str = "contains", target: str = "any") -> None:
        self.expression = expression
        self.mode = mode
        self.target = target
        self._regex: re.Pattern[str] | None = None
        self._jsonpath: Any = None
        self._header_name: str | None = None
        self._header_value: str | None = None
        if not expression:
            return
        if expression.startswith(HEADER_PREFIX) or target == "header":
            self.target = "header"
            spec = expression[len(HEADER_PREFIX) :] if expression.startswith(HEADER_PREFIX) else expression
            name, sep, value = spec.partition("=")
            name = name.strip()
            if not name:
                raise BadRequest("header filter needs a name: header:<name>=<value>")
            self._header_name = name
            self._header_value = value if sep else None
            expression = self._header_value or ""
            if mode == "jsonpath":
                raise BadRequest("header filters support contains/regex only")
            if not expression:
                return
        if mode == "regex":
            if NESTED_QUANTIFIER.search(expression):
                raise BadRequest("regex filter rejected: nested quantifiers can take exponential time")
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
        if self._header_name is not None:
            return self._matches_header(message)
        if self._jsonpath is not None:
            candidates = {
                "key": (message.get("key"),),
                "value": (message.get("value"),),
            }.get(self.target, (message.get("value"), message.get("key")))
            for candidate in candidates:
                if not isinstance(candidate, dict | list):
                    continue
                # try the document itself and wrapped in a list, so root filters
                # like `$[?(@.region=='emea')]` work on single objects too
                for doc in (candidate, [candidate]):
                    with contextlib.suppress(Exception):
                        if self._jsonpath.find(doc):
                            return True
            return False
        haystack = _searchable(message, self.target)
        return self._text_match(haystack)

    def _text_match(self, haystack: str) -> bool:
        if len(haystack) > MAX_FILTER_HAYSTACK:
            haystack = haystack[:MAX_FILTER_HAYSTACK]
        if self._regex is not None:
            return bool(self._regex.search(haystack))
        return (self._header_value if self._header_name is not None else self.expression or "").lower() in (
            haystack.lower()
        )

    def _matches_header(self, message: dict[str, Any]) -> bool:
        headers = message.get("headers") or {}
        if not isinstance(headers, dict) or self._header_name not in headers:
            return False
        if not self._header_value:
            return True
        raw = headers[self._header_name]
        return self._text_match(_flat_str(raw))


def _flat_str(value: Any) -> str:
    import orjson

    if value is None:
        return ""
    return value if isinstance(value, str) else orjson.dumps(value).decode("utf-8", "replace")


def _searchable(message: dict[str, Any], target: str = "any") -> str:
    scoped = {"key": ("key",), "value": ("value",), "header": ("headers",)}
    fields = scoped.get(target, ("key", "value", "headers"))
    parts = []
    for key in fields:
        v = message.get(key)
        if v is None:
            continue
        parts.append(_flat_str(v))
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
            if req.mode == "tail":
                wanted_offset = (req.start_offsets or {}).get(part, req.offset)
                start = high if wanted_offset is None else max(low, min(int(wanted_offset), high))
                plan.append((part, start, high))
                continue
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
        predicate = MessageFilter(req.filter, req.filter_mode, req.filter_target)
        try:
            plan = await self._plan(req)
        except Exception as exc:
            yield {"type": "error", "error": str(exc)}
            return
        state.assignments = [{"partition": p, "startOffset": s, "endOffset": e} for p, s, e in plan]
        if req.tail:
            inner = self._tail(req, plan, state, predicate)
            try:
                async for event in inner:
                    yield event
            finally:
                await inner.aclose()  # closing us must close the consumer right away, not at GC
            return
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

    async def _tail(
        self,
        req: BrowseRequest,
        plan: list[tuple[int, int, int]],
        state: BrowseState,
        predicate: MessageFilter,
    ) -> AsyncIterator[dict[str, Any]]:
        """Follow the topic indefinitely: stream every new record until the consumer is cancelled.

        Emits a ``progress`` heartbeat every ``req.heartbeat_interval`` seconds carrying the
        current end offsets and how many records the client is ``behind``. Records are flushed
        one poll at a time (≤ every ``TAIL_FLUSH_INTERVAL`` seconds), so a hot topic cannot flood
        the client with one event per record.
        """
        consumer = self._make_consumer()
        position = {p: s for p, s, _e in plan}  # next offset we expect per partition
        end_offsets = {p: e for p, _s, e in plan}
        try:
            self._assign(consumer, req.topic, plan)
            yield self._heartbeat(state, position, end_offsets)
            next_heartbeat = time.monotonic() + req.heartbeat_interval
            while True:
                raw = await asyncio.to_thread(self._poll, consumer, POLL_BATCH, TAIL_FLUSH_INTERVAL)
                for msg in raw:
                    state.scanned += 1
                    position[msg.partition()] = msg.offset() + 1
                    end_offsets[msg.partition()] = max(end_offsets.get(msg.partition(), 0), msg.offset() + 1)
                    decoded = await self._decode(msg, req)
                    if not predicate.matches(decoded):
                        continue
                    state.matched += 1
                    yield {"type": "message", "message": decoded}
                if time.monotonic() >= next_heartbeat:
                    with contextlib.suppress(Exception):
                        marks = await self.admin.watermarks([(req.topic, p) for p in position])
                        for (_t, part), (_low, high) in marks.items():
                            end_offsets[part] = high
                    yield self._heartbeat(state, position, end_offsets)
                    next_heartbeat = time.monotonic() + req.heartbeat_interval
        finally:
            # closed synchronously: a cancelled generator must not await in ``finally``
            with contextlib.suppress(Exception):
                consumer.close()

    @staticmethod
    def _heartbeat(
        state: BrowseState, position: dict[int, int], end_offsets: dict[int, int]
    ) -> dict[str, Any]:
        behind = sum(max(0, end_offsets.get(p, 0) - pos) for p, pos in position.items())
        return {
            "type": "progress",
            "scanned": state.scanned,
            "matched": state.matched,
            "done": False,
            "live": True,
            "behind": behind,
            "endOffsets": {str(p): e for p, e in sorted(end_offsets.items())},
            "positions": {str(p): pos for p, pos in sorted(position.items())},
        }

    async def collect(self, req: BrowseRequest) -> dict[str, Any]:
        """Non-streaming variant → ``{items, scanned, matched, truncated, assignments}``."""
        if req.tail:
            raise BadRequest("mode=tail is streaming only (stream=true)")
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
