"""Broker list, detail, configs, log dirs and metrics."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from k_shui.api.routers._common import sampler_for
from k_shui.api.schemas.cluster import Broker, LogDir
from k_shui.api.schemas.common import ConfigEntry, ConfigUpdate, SeriesResponse
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_admin, require_viewer
from k_shui.core.deps import TimeRange, series, time_range
from k_shui.core.errors import NotFound
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/brokers", tags=["brokers"])


async def _brokers(ctx: ClusterContext) -> list[dict]:
    admin = KafkaAdmin.get(ctx)
    md = await admin.metadata()
    logdirs = await admin.describe_log_dirs()
    sizes = {
        broker_id: sum(d.get("sizeBytes") or 0 for d in dirs) or None
        for broker_id, dirs in (logdirs.get("brokers") or {}).items()
    }
    version = await admin.broker_version()
    out = []
    for broker_id, b in sorted(md.brokers.items()):
        partitions = leaders = urp = 0
        for topic in md.topics.values():
            for p in topic.partitions.values():
                if broker_id in p.replicas:
                    partitions += 1
                    if len(p.isrs) < len(p.replicas):
                        urp += 1
                if p.leader == broker_id:
                    leaders += 1
        out.append(
            {
                "id": broker_id,
                "host": b.host,
                "port": b.port,
                "rack": getattr(b, "rack", None) or None,
                "isController": broker_id == md.controller_id,
                "partitionCount": partitions,
                "leaderCount": leaders,
                "underReplicatedPartitions": urp,
                "logDirSizeBytes": sizes.get(str(broker_id)),
                "status": "online",
                "version": version,
            }
        )
    return out


@router.get("", response_model=list[Broker])
async def list_brokers(
    ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[Broker]:
    return [Broker(**b) for b in await _brokers(ctx)]


@router.get("/{broker_id}", response_model=Broker)
async def get_broker(
    broker_id: int, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> Broker:
    for b in await _brokers(ctx):
        if b["id"] == broker_id:
            return Broker(**b)
    raise NotFound(f"broker {broker_id} not found")


@router.get("/{broker_id}/configs", response_model=list[ConfigEntry])
async def broker_configs(
    broker_id: int, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[ConfigEntry]:
    entries = await KafkaAdmin.get(ctx).describe_configs("broker", str(broker_id))
    return [ConfigEntry(**e) for e in entries]


@router.put("/{broker_id}/configs", response_model=list[ConfigEntry])
async def update_broker_configs(
    broker_id: int,
    body: ConfigUpdate,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> list[ConfigEntry]:
    entries = await KafkaAdmin.get(ctx).alter_configs("broker", str(broker_id), body.configs)
    await audit(
        request, "broker.configs.update", resource=f"broker/{broker_id}", details={"keys": list(body.configs)}
    )
    publish("broker.config.updated", ctx.config.id, {"brokerId": broker_id, "keys": list(body.configs)})
    return [ConfigEntry(**e) for e in entries]


@router.get("/{broker_id}/logdirs", response_model=list[LogDir])
async def broker_logdirs(
    broker_id: int, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[LogDir]:
    result = await KafkaAdmin.get(ctx).describe_log_dirs([broker_id])
    dirs = (result.get("brokers") or {}).get(str(broker_id), [])
    return [LogDir(**d) for d in dirs]


@router.get("/{broker_id}/metrics", response_model=SeriesResponse)
async def broker_metrics(
    broker_id: int,
    request: Request,
    tr: TimeRange = Depends(time_range),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> SeriesResponse:
    """Sampled fallback: only cluster-wide throughput is available without JMX/Prometheus."""
    sampler = sampler_for(request, ctx.config.id)
    if sampler is None:
        return SeriesResponse(series=[], source="sampled")
    labels = {"broker": str(broker_id)}
    return SeriesResponse(
        series=[
            series(
                "bytesIn", sampler.series(tr.start, tr.end, lambda s: s.messages * 1024, rate=True), labels
            ),
            series(
                "bytesOut", sampler.series(tr.start, tr.end, lambda s: s.messages * 1024, rate=True), labels
            ),
            series("requestHandlerIdle", [], labels),
            series("networkProcessorIdle", [], labels),
            series("produceLatencyP99", [], labels),
            series("fetchLatencyP99", [], labels),
            series("jvmHeapUsed", [], labels),
            series("gcTime", [], labels),
        ],
        source="sampled",
    )
