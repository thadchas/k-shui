"""Cluster list, detail, health and overview metrics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from k_shui.api.routers._common import cluster_summary, sampler_for
from k_shui.api.schemas.cluster import (
    ClusterDetail,
    ClusterSummary,
    UnhealthyPartition,
    UnhealthyPartitionsResponse,
)
from k_shui.api.schemas.common import HealthCheck, HealthResponse, SeriesResponse
from k_shui.core.auth import Principal, require_viewer
from k_shui.core.deps import TimeRange, time_range
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext, ClusterRegistry, get_cluster, get_registry
from k_shui.kafka.admin import KafkaAdmin

log = get_logger(__name__)
router = APIRouter(prefix="/clusters", tags=["clusters"])


@router.get("", response_model=list[ClusterSummary])
async def list_clusters(
    request: Request,
    registry: ClusterRegistry = Depends(get_registry),
    principal: Principal = Depends(require_viewer),
) -> list[ClusterSummary]:
    out = []
    for ctx in registry.all():
        if not principal.sees_cluster(ctx.config.id):
            continue
        out.append(ClusterSummary(**await cluster_summary(ctx, request)))
    return out


@router.get("/{cluster_id}", response_model=ClusterDetail)
async def get_cluster_detail(
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> ClusterDetail:
    return ClusterDetail(**await cluster_summary(ctx, request, detail=True))


@router.get("/{cluster_id}/health", response_model=HealthResponse)
async def cluster_health(
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> HealthResponse:
    checks: list[HealthCheck] = []
    admin = KafkaAdmin.get(ctx)
    overall = "ok"
    try:
        info = await admin.describe_cluster()
        checks.append(
            HealthCheck(
                name="kafka",
                status="ok",
                message=f"{info['brokerCount']} broker(s), cluster {info['clusterId']}",
            )
        )
    except Exception as exc:
        checks.append(HealthCheck(name="kafka", status="error", message=str(exc)))
        return HealthResponse(status="offline", checks=checks)

    sampler = sampler_for(request, ctx.config.id)
    sample = sampler.latest if sampler else None
    if sample is not None and sample.error is None:
        urp_status = "ok" if sample.under_replicated == 0 else "warn"
        checks.append(
            HealthCheck(
                name="underReplicatedPartitions", status=urp_status, message=str(sample.under_replicated)
            )
        )
        off_status = "ok" if sample.offline_partitions == 0 else "error"
        checks.append(
            HealthCheck(name="offlinePartitions", status=off_status, message=str(sample.offline_partitions))
        )
        checks.append(
            HealthCheck(
                name="controller",
                status="ok" if sample.controller_id is not None else "error",
                message=f"broker {sample.controller_id}",
            )
        )
        if off_status == "error" or urp_status == "warn":
            overall = "degraded"

    for name, check in _integration_checks(ctx).items():
        checks.append(HealthCheck(name=name, status="ok", message=check))
    return HealthResponse(status=overall, checks=checks)


def _integration_checks(ctx: ClusterContext) -> dict[str, str]:
    cfg = ctx.config
    out: dict[str, str] = {}
    if cfg.schemaRegistry:
        out["schemaRegistry"] = f"configured ({cfg.schemaRegistry.type})"
    for c in cfg.connect:
        out[f"connect:{c.name}"] = c.url
    for k in cfg.ksqldb:
        out[f"ksql:{k.name}"] = k.url
    for f in cfg.flink:
        out[f"flink:{f.name}"] = f.url
    if cfg.prometheus:
        out["prometheus"] = cfg.prometheus.url
    if cfg.lineage and cfg.lineage.type != "none":
        out["lineage"] = cfg.lineage.url or cfg.lineage.type
    return out


@router.get("/{cluster_id}/partitions/unhealthy", response_model=UnhealthyPartitionsResponse)
async def unhealthy_partitions(
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> UnhealthyPartitionsResponse:
    """Cluster-wide list of partitions that are offline, under-replicated or led by a non-preferred replica.

    Built from one metadata round-trip; ``offline`` means no live leader (``leader < 0``),
    ``underReplicated`` means ``|isr| < |replicas|`` and ``nonPreferredLeader`` means the leader is not
    the first replica in the assignment (a partition still needs a preferred-leader election).
    """
    md = await KafkaAdmin.get(ctx).metadata(force=True)
    items: list[UnhealthyPartition] = []
    scanned = offline = urp = non_preferred = 0
    for name, topic in md.topics.items():
        for p in topic.partitions.values():
            scanned += 1
            replicas = list(p.replicas)
            isr = list(p.isrs)
            leader = p.leader if p.leader is not None and p.leader >= 0 else None
            reasons: list[str] = []
            if leader is None:
                reasons.append("offline")
            if len(isr) < len(replicas):
                reasons.append("underReplicated")
            if leader is not None and replicas and leader != replicas[0]:
                reasons.append("nonPreferredLeader")
            if not reasons:
                continue
            offline += "offline" in reasons
            urp += "underReplicated" in reasons
            non_preferred += "nonPreferredLeader" in reasons
            items.append(
                UnhealthyPartition(
                    topic=name, partition=p.id, leader=leader, replicas=replicas, isr=isr, reasons=reasons
                )
            )
    # Offline first, then under-replicated, then by topic/partition so the worst rows lead.
    items.sort(
        key=lambda i: ("offline" not in i.reasons, "underReplicated" not in i.reasons, i.topic, i.partition)
    )
    return UnhealthyPartitionsResponse(
        items=items,
        offline=offline,
        underReplicated=urp,
        nonPreferredLeader=non_preferred,
        scannedPartitions=scanned,
    )


@router.get("/{cluster_id}/overview/metrics", response_model=SeriesResponse)
async def overview_metrics(
    request: Request,
    tr: TimeRange = Depends(time_range),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> SeriesResponse:
    if ctx.config.metricsMode == "prometheus":
        prom = await _prometheus_overview(ctx, tr)
        if prom is not None:
            return SeriesResponse(series=prom, source="prometheus")
    sampler = sampler_for(request, ctx.config.id)
    if sampler is None:
        return SeriesResponse(series=[], source="sampled")
    return SeriesResponse(series=sampler.overview_series(tr.start, tr.end), source="sampled")


async def _prometheus_overview(ctx: ClusterContext, tr: TimeRange) -> list[dict[str, Any]] | None:
    """Delegate to the Prometheus integration when it is available; else fall back."""
    try:
        from k_shui.integrations.prometheus import get_overview_series  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        return None
    try:
        return await get_overview_series(ctx, tr)
    except Exception as exc:
        log.debug("prometheus.overview_failed", cluster=ctx.config.id, error=str(exc))
        return None
