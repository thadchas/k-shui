"""Topic CRUD, configs, partitions, purge, clone, consumers, schema and metrics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.routers._common import paginate_sort, sampler_for, schema_flags, topic_rate
from k_shui.api.schemas.common import Ack, ConfigEntry, ConfigUpdate, Page, SeriesResponse
from k_shui.api.schemas.group import TopicConsumer
from k_shui.api.schemas.topic import (
    AddPartitionsRequest,
    CloneTopicRequest,
    CreateTopicRequest,
    PurgeRequest,
    TopicDetail,
    TopicSchemaRef,
    TopicSchemaResponse,
    TopicSummary,
)
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_editor, require_viewer
from k_shui.core.deps import Pagination, TimeRange, pagination, time_range
from k_shui.core.errors import BadRequest, NotFound
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/topics", tags=["topics"])

BYTES_PER_MESSAGE_ESTIMATE = 1024


def _config_int(configs: dict[str, Any], key: str) -> int | None:
    raw = configs.get(key)
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


@router.get("", response_model=Page[TopicSummary])
async def list_topics(
    request: Request,
    search: str | None = Query(None),
    showInternal: bool = Query(False),
    sort: str | None = Query(None),
    order: str = Query("asc"),
    page: Pagination = Depends(pagination),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> Page[TopicSummary]:
    admin = KafkaAdmin.get(ctx)
    topics = await admin.list_topics(include_internal=showInternal)
    if search:
        needle = search.lower()
        topics = [t for t in topics if needle in t["name"].lower()]
    topics = paginate_sort(topics, sort, order)
    total = len(topics)
    window = page.slice(topics)
    names = [t["name"] for t in window]

    marks = await admin.watermarks(
        [(t["name"], p) for t in window for p in range(t["partitions"])] if window else []
    )
    flags = await schema_flags(ctx, names)
    configs_by_topic: dict[str, dict[str, Any]] = {}
    for name in names:
        try:
            entries = await admin.describe_configs("topic", name)
            configs_by_topic[name] = {e["name"]: e["value"] for e in entries}
        except Exception:
            configs_by_topic[name] = {}

    sampler = sampler_for(request, ctx.config.id)
    items: list[TopicSummary] = []
    for t in window:
        name = t["name"]
        count = sum(max(high - low, 0) for (tp, _p), (low, high) in marks.items() if tp == name)
        cfg = configs_by_topic.get(name, {})
        rate = topic_rate(sampler, name)
        items.append(
            TopicSummary(
                name=name,
                partitions=t["partitions"],
                replicationFactor=t["replicationFactor"],
                isInternal=t["isInternal"],
                underReplicatedPartitions=t["underReplicatedPartitions"],
                offlinePartitions=t.get("offlinePartitions", 0),
                sizeBytes=count * BYTES_PER_MESSAGE_ESTIMATE,
                messageCount=count,
                cleanupPolicy=cfg.get("cleanup.policy"),
                retentionMs=_config_int(cfg, "retention.ms"),
                hasSchema=flags.get(name, {"key": False, "value": False}),
                bytesInPerSec=rate * BYTES_PER_MESSAGE_ESTIMATE,
                bytesOutPerSec=rate * BYTES_PER_MESSAGE_ESTIMATE,
            )
        )
    return Page[TopicSummary](items=items, page=page.page, perPage=page.per_page, total=total)


@router.post("", response_model=TopicDetail, status_code=201)
async def create_topic(
    body: CreateTopicRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> TopicDetail:
    admin = KafkaAdmin.get(ctx)
    configs = {k: str(v) for k, v in (body.configs or {}).items()}
    await admin.create_topic(body.name, body.partitions, body.replicationFactor, configs)
    await audit(request, "topic.create", resource=body.name, details={"partitions": body.partitions})
    publish("topic.created", ctx.config.id, {"topic": body.name})
    return await _topic_detail(ctx, body.name, request)


@router.get("/{topic}", response_model=TopicDetail)
async def get_topic(
    topic: str,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> TopicDetail:
    return await _topic_detail(ctx, topic, request)


async def _topic_detail(ctx: ClusterContext, topic: str, request: Request) -> TopicDetail:
    admin = KafkaAdmin.get(ctx)
    detail = await admin.describe_topic(topic)
    marks = await admin.watermarks([(topic, p["id"]) for p in detail["partitionsDetail"]])
    try:
        entries = await admin.describe_configs("topic", topic)
    except Exception:
        entries = []
    cfg = {e["name"]: e["value"] for e in entries}
    partitions = []
    total = 0
    for p in detail["partitionsDetail"]:
        low, high = marks.get((topic, p["id"]), (0, 0))
        count = max(high - low, 0)
        total += count
        partitions.append(
            {
                **p,
                "beginOffset": low,
                "endOffset": high,
                "sizeBytes": count * BYTES_PER_MESSAGE_ESTIMATE,
            }
        )
    flags = (await schema_flags(ctx, [topic])).get(topic, {"key": False, "value": False})
    rate = topic_rate(sampler_for(request, ctx.config.id), topic)
    return TopicDetail(
        name=topic,
        partitions=detail["partitions"],
        replicationFactor=detail["replicationFactor"],
        isInternal=detail["isInternal"],
        underReplicatedPartitions=sum(1 for p in partitions if p["underReplicated"]),
        offlinePartitions=sum(1 for p in partitions if p["offline"]),
        sizeBytes=total * BYTES_PER_MESSAGE_ESTIMATE,
        messageCount=total,
        cleanupPolicy=cfg.get("cleanup.policy"),
        retentionMs=_config_int(cfg, "retention.ms"),
        hasSchema=flags,
        bytesInPerSec=rate * BYTES_PER_MESSAGE_ESTIMATE,
        bytesOutPerSec=rate * BYTES_PER_MESSAGE_ESTIMATE,
        partitionsDetail=partitions,
        configs=[ConfigEntry(**e) for e in entries if not e["isDefault"]],
    )


@router.delete("/{topic}", response_model=Ack)
async def delete_topic(
    topic: str,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> Ack:
    await KafkaAdmin.get(ctx).delete_topic(topic)
    await audit(request, "topic.delete", resource=topic)
    publish("topic.deleted", ctx.config.id, {"topic": topic})
    return Ack(detail=f"topic '{topic}' deleted")


@router.get("/{topic}/configs", response_model=list[ConfigEntry])
async def topic_configs(
    topic: str, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[ConfigEntry]:
    return [ConfigEntry(**e) for e in await KafkaAdmin.get(ctx).describe_configs("topic", topic)]


@router.put("/{topic}/configs", response_model=list[ConfigEntry])
async def update_topic_configs(
    topic: str,
    body: ConfigUpdate,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> list[ConfigEntry]:
    entries = await KafkaAdmin.get(ctx).alter_configs("topic", topic, body.configs)
    await audit(request, "topic.configs.update", resource=topic, details={"keys": list(body.configs)})
    return [ConfigEntry(**e) for e in entries]


@router.post("/{topic}/partitions", response_model=TopicDetail)
async def add_partitions(
    topic: str,
    body: AddPartitionsRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> TopicDetail:
    await KafkaAdmin.get(ctx).create_partitions(topic, body.count)
    await audit(request, "topic.partitions.add", resource=topic, details={"count": body.count})
    return await _topic_detail(ctx, topic, request)


@router.post("/{topic}/purge")
async def purge_topic(
    topic: str,
    request: Request,
    body: PurgeRequest | None = None,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> dict[str, Any]:
    admin = KafkaAdmin.get(ctx)
    detail = await admin.describe_topic(topic)
    if body and body.partitions:
        targets = [(topic, p.id, p.beforeOffset) for p in body.partitions]
    else:
        targets = [(topic, p["id"], -1) for p in detail["partitionsDetail"]]
    result = await admin.delete_records(targets)
    await audit(request, "topic.purge", resource=topic, details={"partitions": len(targets)})
    publish("topic.purged", ctx.config.id, {"topic": topic})
    return {"topic": topic, "partitions": result}


@router.post("/{topic}/clone", response_model=TopicDetail, status_code=201)
async def clone_topic(
    topic: str,
    body: CloneTopicRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> TopicDetail:
    admin = KafkaAdmin.get(ctx)
    source = await admin.describe_topic(topic)
    entries = await admin.describe_configs("topic", topic)
    configs = {e["name"]: str(e["value"]) for e in entries if not e["isDefault"] and e["value"] is not None}
    await admin.create_topic(
        body.name,
        body.partitions or source["partitions"],
        body.replicationFactor or source["replicationFactor"],
        configs,
    )
    await audit(request, "topic.clone", resource=body.name, details={"from": topic})
    publish("topic.created", ctx.config.id, {"topic": body.name, "clonedFrom": topic})
    return await _topic_detail(ctx, body.name, request)


@router.get("/{topic}/consumers", response_model=list[TopicConsumer])
async def topic_consumers(
    topic: str, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[TopicConsumer]:
    admin = KafkaAdmin.get(ctx)
    detail = await admin.describe_topic(topic)
    marks = await admin.watermarks([(topic, p["id"]) for p in detail["partitionsDetail"]])
    out: list[TopicConsumer] = []
    for g in await admin.list_groups():
        try:
            offsets = await admin.group_offsets(g["groupId"], [topic])
        except Exception:
            continue
        if not offsets:
            continue
        lag = sum(max(marks.get((topic, o["partition"]), (0, 0))[1] - o["offset"], 0) for o in offsets)
        described = await admin.describe_groups([g["groupId"]])
        members = len(described.get(g["groupId"], {}).get("members", []))
        out.append(TopicConsumer(groupId=g["groupId"], state=g["state"], lag=lag, members=members))
    return out


@router.get("/{topic}/schema", response_model=TopicSchemaResponse)
async def topic_schema(
    topic: str, ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> TopicSchemaResponse:
    from k_shui.kafka.serdes.registry import SerdeRegistryClient

    client = SerdeRegistryClient.get(ctx)
    if client is None:
        return TopicSchemaResponse(key=None, value=None, strategy="topic")
    refs: dict[str, TopicSchemaRef | None] = {"key": None, "value": None}
    for kind in ("key", "value"):
        try:
            entry = await client.get_latest(f"{topic}-{kind}")
            refs[kind] = TopicSchemaRef(
                subject=entry["subject"],
                version=entry["version"],
                schemaId=entry["id"],
                type=entry["schemaType"],
            )
        except Exception:
            refs[kind] = None
    strategy = ctx.config.schemaRegistry.keySubjectNameStrategy if ctx.config.schemaRegistry else "topic"
    return TopicSchemaResponse(key=refs["key"], value=refs["value"], strategy=strategy)


@router.get("/{topic}/metrics", response_model=SeriesResponse)
async def topic_metrics(
    topic: str,
    request: Request,
    tr: TimeRange = Depends(time_range),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> SeriesResponse:
    sampler = sampler_for(request, ctx.config.id)
    if sampler is None:
        raise NotFound("no sampler running for this cluster")
    if not any(
        p["id"] is not None for p in (await KafkaAdmin.get(ctx).describe_topic(topic))["partitionsDetail"]
    ):
        raise BadRequest(f"topic '{topic}' has no partitions")
    return SeriesResponse(series=sampler.topic_series(topic, tr.start, tr.end), source="sampled")
