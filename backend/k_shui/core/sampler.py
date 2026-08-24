"""Per-cluster background sampler.

Every ``pollIntervalSeconds`` it snapshots end offsets, partition counts, under-replicated
partitions and consumer-group lag into a 24h ring buffer, so overview / topic / consumer-lag
time series work without Prometheus (``metricsMode: sampled``).
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from k_shui.core.events import publish
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext, ClusterRegistry

log = get_logger(__name__)

RETENTION_SECONDS = 24 * 3600


@dataclass(slots=True)
class Sample:
    ts: float
    messages: int = 0
    topics: int = 0
    partitions: int = 0
    brokers: int = 0
    online_brokers: int = 0
    under_replicated: int = 0
    offline_partitions: int = 0
    in_sync_pct: float = 100.0
    controller_id: int | None = None
    per_topic: dict[str, int] = field(default_factory=dict)  # topic → total end offset
    per_group: dict[str, int] = field(default_factory=dict)  # groupId → total lag
    per_group_topic: dict[str, dict[str, int]] = field(default_factory=dict)
    error: str | None = None


def _rate(points: list[tuple[float, float]]) -> list[list[float]]:
    """Convert a cumulative counter series into a per-second rate series."""
    out: list[list[float]] = []
    for (t0, v0), (t1, v1) in itertools.pairwise(points):
        dt = t1 - t0
        if dt <= 0:
            continue
        out.append([int(t1 * 1000), max((v1 - v0) / dt, 0.0)])
    return out


class ClusterSampler:
    """Ring buffer + poll loop for one cluster."""

    def __init__(self, ctx: ClusterContext) -> None:
        self.ctx = ctx
        self.cluster_id = ctx.config.id
        self.interval = max(int(ctx.config.pollIntervalSeconds or 15), 5)
        maxlen = max(int(RETENTION_SECONDS / self.interval), 60)
        self.samples: deque[Sample] = deque(maxlen=maxlen)
        self._task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()
        self.last_error: str | None = None

    # -------------------------------------------------------------- lifecycle
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopped.clear()
            self._task = asyncio.create_task(self._loop(), name=f"sampler-{self.cluster_id}")

    async def stop(self) -> None:
        self._stopped.set()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while not self._stopped.is_set():
            try:
                await self.sample_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.last_error = str(exc)
                log.debug("sampler.failed", cluster=self.cluster_id, error=str(exc))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stopped.wait(), timeout=self.interval)

    # -------------------------------------------------------------- sampling
    async def sample_once(self) -> Sample:
        from k_shui.kafka.admin import KafkaAdmin

        admin = KafkaAdmin.get(self.ctx)
        now = time.time()
        sample = Sample(ts=now)
        try:
            md = await admin.metadata(force=True)
        except Exception as exc:  # cluster offline
            sample.error = str(exc)
            self.last_error = str(exc)
            self.samples.append(sample)
            self._maybe_emit_status(offline=True)
            return sample

        self.last_error = None
        sample.brokers = len(md.brokers)
        sample.online_brokers = len(md.brokers)
        sample.controller_id = md.controller_id
        sample.topics = len(md.topics)
        replicas = in_sync = 0
        parts: list[tuple[str, int]] = []
        for name, topic in md.topics.items():
            for p in topic.partitions.values():
                sample.partitions += 1
                replicas += len(p.replicas)
                in_sync += len(p.isrs)
                if len(p.isrs) < len(p.replicas):
                    sample.under_replicated += 1
                if p.leader < 0:
                    sample.offline_partitions += 1
                parts.append((name, p.id))
        sample.in_sync_pct = round(100.0 * in_sync / replicas, 2) if replicas else 100.0

        try:
            watermarks = await admin.watermarks(parts)
        except Exception as exc:
            watermarks = {}
            sample.error = str(exc)
        end_by_topic: dict[str, int] = {}
        for (topic, _part), (_low, high) in watermarks.items():
            end_by_topic[topic] = end_by_topic.get(topic, 0) + max(high, 0)
        sample.per_topic = end_by_topic
        sample.messages = sum(end_by_topic.values())

        await self._sample_groups(admin, sample, watermarks)
        self.samples.append(sample)
        self._maybe_emit_status(offline=False)
        return sample

    async def _sample_groups(
        self, admin: Any, sample: Sample, watermarks: dict[tuple[str, int], tuple[int, int]]
    ) -> None:
        try:
            groups = await admin.list_groups()
        except Exception:
            return
        for g in groups[:200]:
            group_id = g["groupId"]
            try:
                committed = await admin.group_offsets(group_id)
            except Exception:
                continue
            total = 0
            per_topic: dict[str, int] = {}
            for entry in committed:
                key = (entry["topic"], entry["partition"])
                end = watermarks.get(key, (0, 0))[1]
                lag = max(end - entry["offset"], 0)
                total += lag
                per_topic[entry["topic"]] = per_topic.get(entry["topic"], 0) + lag
            sample.per_group[group_id] = total
            sample.per_group_topic[group_id] = per_topic

    def _maybe_emit_status(self, offline: bool) -> None:
        previous = self.samples[-2] if len(self.samples) > 1 else None
        was_offline = previous is not None and previous.error is not None
        if offline != was_offline and previous is not None:
            publish("cluster.status", self.cluster_id, {"status": "offline" if offline else "online"})

    # -------------------------------------------------------------- queries
    @property
    def latest(self) -> Sample | None:
        return self.samples[-1] if self.samples else None

    def window(self, start: float, end: float) -> list[Sample]:
        return [s for s in self.samples if start <= s.ts <= end and s.error is None]

    def series(self, start: float, end: float, extract: Any, rate: bool = False) -> list[list[float]]:
        points = [(s.ts, float(extract(s) or 0)) for s in self.window(start, end)]
        if rate:
            return _rate(points)
        return [[int(t * 1000), v] for t, v in points]

    def overview_series(self, start: float, end: float) -> list[dict[str, Any]]:
        """Series named as in the ARCHITECTURE overview contract."""
        from k_shui.core.deps import series as mk

        return [
            mk("messagesIn", self.series(start, end, lambda s: s.messages, rate=True)),
            mk("bytesIn", self.series(start, end, lambda s: s.messages * 1024, rate=True)),
            mk("bytesOut", self.series(start, end, lambda s: s.messages * 1024, rate=True)),
            mk("requestRate", self.series(start, end, lambda s: s.messages, rate=True)),
            mk(
                "activeControllers",
                self.series(start, end, lambda s: 1 if s.controller_id is not None else 0),
            ),
            mk("underReplicated", self.series(start, end, lambda s: s.under_replicated)),
            mk("offlinePartitions", self.series(start, end, lambda s: s.offline_partitions)),
        ]

    def topic_series(self, topic: str, start: float, end: float) -> list[dict[str, Any]]:
        from k_shui.core.deps import series as mk

        def end_offset(s: Sample) -> int:
            return s.per_topic.get(topic, 0)

        return [
            mk("messagesIn", self.series(start, end, end_offset, rate=True), {"topic": topic}),
            mk(
                "bytesIn",
                self.series(start, end, lambda s: end_offset(s) * 1024, rate=True),
                {"topic": topic},
            ),
            mk(
                "bytesOut",
                self.series(start, end, lambda s: end_offset(s) * 1024, rate=True),
                {"topic": topic},
            ),
            mk("size", self.series(start, end, lambda s: end_offset(s) * 1024), {"topic": topic}),
        ]

    def group_lag_series(self, group_id: str, start: float, end: float) -> list[dict[str, Any]]:
        from k_shui.core.deps import series as mk

        topics: set[str] = set()
        for s in self.window(start, end):
            topics.update(s.per_group_topic.get(group_id, {}))
        out = [
            mk("lag", self.series(start, end, lambda s: s.per_group.get(group_id, 0)), {"group": group_id})
        ]
        for topic in sorted(topics):
            out.append(
                mk(
                    "lag",
                    self.series(start, end, lambda s, t=topic: s.per_group_topic.get(group_id, {}).get(t, 0)),
                    {"group": group_id, "topic": topic},
                )
            )
        return out


class SamplerManager:
    """Owns one :class:`ClusterSampler` per configured cluster."""

    def __init__(self, registry: ClusterRegistry) -> None:
        self.samplers: dict[str, ClusterSampler] = {
            ctx.config.id: ClusterSampler(ctx) for ctx in registry.all()
        }

    def get(self, cluster_id: str) -> ClusterSampler | None:
        return self.samplers.get(cluster_id)

    def start(self) -> None:
        for s in self.samplers.values():
            s.start()

    async def stop(self) -> None:
        await asyncio.gather(*(s.stop() for s in self.samplers.values()), return_exceptions=True)

    def online_count(self) -> int:
        return sum(1 for s in self.samplers.values() if s.latest is not None and s.latest.error is None)


def get_sampler(request: Any, cluster_id: str) -> ClusterSampler | None:
    manager: SamplerManager | None = getattr(request.app.state, "samplers", None)
    return manager.get(cluster_id) if manager else None


__all__ = ["ClusterSampler", "Sample", "SamplerManager", "get_sampler"]
