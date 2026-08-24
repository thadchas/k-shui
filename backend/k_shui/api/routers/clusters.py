"""Cluster list, detail, health and overview metrics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from k_shui.api.routers._common import cluster_summary, sampler_for
from k_shui.api.schemas.cluster import ClusterDetail, ClusterSummary
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
