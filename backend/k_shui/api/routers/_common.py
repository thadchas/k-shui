"""Helpers shared by the core routers (cluster summaries, sampler access, schema flags)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import Request

from k_shui.core.errors import BadRequest
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext
from k_shui.core.sampler import ClusterSampler, Sample
from k_shui.kafka.admin import KafkaAdmin

log = get_logger(__name__)

# A cluster listing must stay responsive even when a broker is unreachable, so both the
# reachability probe and the on-demand sampling fallback get hard deadlines instead of
# inheriting the (much longer) Kafka client timeouts.
SUMMARY_PROBE_DEADLINE = 5.0
SUMMARY_SAMPLE_DEADLINE = 5.0


def sampler_for(request: Request, cluster_id: str) -> ClusterSampler | None:
    manager = getattr(request.app.state, "samplers", None)
    return manager.get(cluster_id) if manager is not None else None


def rates_from(sampler: ClusterSampler | None) -> dict[str, float]:
    """Derive per-second rates from the two most recent samples."""
    if sampler is None or len(sampler.samples) < 2:
        return {"messagesInPerSec": 0.0, "bytesInPerSec": 0.0, "bytesOutPerSec": 0.0}
    prev, last = sampler.samples[-2], sampler.samples[-1]
    dt = last.ts - prev.ts
    if dt <= 0 or prev.error or last.error:
        return {"messagesInPerSec": 0.0, "bytesInPerSec": 0.0, "bytesOutPerSec": 0.0}
    rate = max((last.messages - prev.messages) / dt, 0.0)
    return {
        "messagesInPerSec": round(rate, 3),
        "bytesInPerSec": round(rate * 1024, 2),
        "bytesOutPerSec": round(rate * 1024, 2),
    }


def topic_rate(sampler: ClusterSampler | None, topic: str) -> float:
    if sampler is None or len(sampler.samples) < 2:
        return 0.0
    prev, last = sampler.samples[-2], sampler.samples[-1]
    dt = last.ts - prev.ts
    if dt <= 0 or prev.error or last.error:
        return 0.0
    return round(max((last.per_topic.get(topic, 0) - prev.per_topic.get(topic, 0)) / dt, 0.0), 3)


async def cluster_summary(ctx: ClusterContext, request: Request, detail: bool = False) -> dict[str, Any]:
    """Build the `/clusters` (and `/clusters/{c}`) payload, degrading when Kafka is down."""
    cfg = ctx.config
    sampler = sampler_for(request, cfg.id)
    admin = KafkaAdmin.get(ctx)
    base: dict[str, Any] = {
        "id": cfg.id,
        "name": cfg.name or cfg.id,
        "status": "offline",
        "version": None,
        "controllerId": None,
        "brokerCount": 0,
        "onlineBrokers": 0,
        "topicCount": 0,
        "partitionCount": 0,
        "underReplicatedPartitions": 0,
        "offlinePartitions": 0,
        "inSyncReplicasPct": 100.0,
        "bytesInPerSec": 0.0,
        "bytesOutPerSec": 0.0,
        "messagesInPerSec": 0.0,
        "features": cfg.features,
        "error": None,
    }
    if detail:
        base.update(
            {
                "clusterId": None,
                "bootstrapServers": cfg.bootstrapServers,
                "listeners": [],
                "kraft": None,
                "metricsMode": cfg.metricsMode,
                "readOnly": cfg.readOnly,
            }
        )
    try:
        info = await asyncio.wait_for(admin.describe_cluster(), timeout=SUMMARY_PROBE_DEADLINE)
    except TimeoutError:
        base["error"] = f"kafka cluster '{cfg.id}' did not respond within {SUMMARY_PROBE_DEADLINE:g}s"
        return base
    except Exception as exc:
        base["error"] = str(exc)
        return base

    sample: Sample | None = sampler.latest if sampler else None
    if sampler is not None and (sample is None or sample.error is not None):
        try:
            sample = await asyncio.wait_for(sampler.sample_once(), timeout=SUMMARY_SAMPLE_DEADLINE)
        except Exception:  # timeout, or a broker that went away mid-sample
            log.debug("cluster.summary_sample_unavailable", cluster=cfg.id)
            sample = None

    base.update(
        {
            "status": "online",
            "controllerId": info.get("controllerId"),
            "brokerCount": info.get("brokerCount", 0),
            "onlineBrokers": info.get("brokerCount", 0),
            "topicCount": info.get("topicCount", 0),
            "partitionCount": info.get("partitionCount", 0),
        }
    )
    if sample is not None and sample.error is None:
        base.update(
            {
                "underReplicatedPartitions": sample.under_replicated,
                "offlinePartitions": sample.offline_partitions,
                "inSyncReplicasPct": sample.in_sync_pct,
            }
        )
        if sample.under_replicated or sample.offline_partitions:
            base["status"] = "degraded"
    base.update(rates_from(sampler))
    if detail:
        base["clusterId"] = info.get("clusterId")
        base["listeners"] = info.get("listeners", [])
        try:
            base["kraft"] = await admin.kraft_quorum()
        except Exception as exc:
            base["kraft"] = {"supported": False, "reason": str(exc), "voters": [], "observers": []}
        try:
            base["version"] = await admin.broker_version()
        except Exception:
            base["version"] = None
    return base


async def schema_flags(ctx: ClusterContext, topics: list[str]) -> dict[str, dict[str, bool]]:
    """Which topics have ``<topic>-key`` / ``<topic>-value`` subjects registered."""
    from k_shui.kafka.serdes.registry import SerdeRegistryClient

    client = SerdeRegistryClient.get(ctx)
    empty = {t: {"key": False, "value": False} for t in topics}
    if client is None:
        return empty
    try:
        subjects = set(await client._get("/subjects"))
    except Exception as exc:
        log.debug("schema.subjects_failed", cluster=ctx.config.id, error=str(exc))
        return empty
    return {t: {"key": f"{t}-key" in subjects, "value": f"{t}-value" in subjects} for t in topics}


ORDER_PATTERN = "^(asc|desc)$"
TOPIC_SORT_KEYS = frozenset(
    {
        "name",
        "partitions",
        "replicationFactor",
        "isInternal",
        "underReplicatedPartitions",
        "offlinePartitions",
        "sizeBytes",
        "messageCount",
        "cleanupPolicy",
        "retentionMs",
        "bytesInPerSec",
        "bytesOutPerSec",
    }
)
GROUP_SORT_KEYS = frozenset(
    {
        "groupId",
        "state",
        "memberCount",
        "topicCount",
        "partitionCount",
        "totalLag",
        "maxTimeLagMs",
        "coordinatorId",
        "protocol",
    }
)


def _sort_key(value: Any) -> tuple[int, Any]:
    """Total order over mixed/None values: None last, then numbers, booleans, strings, the rest."""
    if value is None:
        return (4, 0)  # filtered out by callers; kept for completeness
    if isinstance(value, bool):
        return (1, int(value))
    if isinstance(value, int | float):
        return (0, value)
    if isinstance(value, str):
        return (2, value.lower())
    return (3, str(value))


def paginate_sort(
    items: list[dict[str, Any]],
    sort: str | None,
    order: str = "asc",
    allowed: frozenset[str] | set[str] | None = None,
) -> list[dict[str, Any]]:
    if not sort:
        return items
    if allowed is not None and sort not in allowed:
        raise BadRequest(f"unknown sort key '{sort}' (expected one of {', '.join(sorted(allowed))})")
    order = (order or "asc").lower()
    if order not in ("asc", "desc"):
        raise BadRequest("order must be 'asc' or 'desc'")
    present = [i for i in items if i.get(sort) is not None]
    absent = [i for i in items if i.get(sort) is None]
    # None always sorts last, whichever the direction; mixed types never raise.
    return sorted(present, key=lambda i: _sort_key(i.get(sort)), reverse=order == "desc") + absent


__all__ = [
    "GROUP_SORT_KEYS",
    "ORDER_PATTERN",
    "TOPIC_SORT_KEYS",
    "cluster_summary",
    "paginate_sort",
    "rates_from",
    "sampler_for",
    "schema_flags",
    "topic_rate",
]
