"""Consumer groups, share groups, offset resets, lag history and CSV export."""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from k_shui.api.routers._common import paginate_sort, sampler_for, topic_rate
from k_shui.api.schemas.common import Ack, Page, SeriesResponse
from k_shui.api.schemas.group import (
    GroupDetail,
    GroupMember,
    GroupPartition,
    GroupSummary,
    GroupTopicSummary,
    ResetOffsetResult,
    ResetOffsetsRequest,
)
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_editor, require_viewer
from k_shui.core.deps import TimeRange, time_range
from k_shui.core.errors import BadRequest, NotFound
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.core.sampler import ClusterSampler
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}", tags=["consumer-groups"])


class _TimeLag:
    """Estimate how far behind the log end a consumer is, in wall-clock terms.

    Kafka has no cheap "timestamp of the committed offset" lookup for every partition, so the
    estimate is ``lag / produce_rate``: the time producers needed to write the messages the
    consumer has not read yet. The produce rate comes from the background sampler, which stores
    the topic-wide end offset every poll interval; the rate of the last two samples is divided
    evenly across the topic's partitions (per-partition end offsets are not retained). The result
    is ``None`` when the sampler has fewer than two samples or the topic is idle (rate <= 0), and
    the UI renders that as an em dash rather than a misleading zero.
    """

    def __init__(self, sampler: ClusterSampler | None, md: Any) -> None:
        self.sampler = sampler
        self.md = md
        self._rates: dict[str, float] = {}

    def _per_partition_rate(self, topic: str) -> float:
        if topic not in self._rates:
            topic_md = self.md.topics.get(topic) if self.md is not None else None
            partitions = len(getattr(topic_md, "partitions", None) or {}) or 1
            self._rates[topic] = topic_rate(self.sampler, topic) / partitions
        return self._rates[topic]

    def ms(self, topic: str, lag: int) -> int | None:
        if lag <= 0:
            return 0
        rate = self._per_partition_rate(topic)
        if rate <= 0:
            return None
        return round(lag / rate * 1000)


def _max_or_none(values: list[int | None]) -> int | None:
    known = [v for v in values if v is not None]
    return max(known) if known else None


async def _summaries(
    ctx: ClusterContext, group_types: list[str] | None = None, sampler: ClusterSampler | None = None
) -> list[dict[str, Any]]:
    admin = KafkaAdmin.get(ctx)
    listing = await admin.list_groups(types=group_types)
    if group_types:
        listing = [g for g in listing if g["groupType"] in group_types]
    described = await admin.describe_groups([g["groupId"] for g in listing])
    time_lag = _TimeLag(sampler, await admin.metadata() if sampler is not None else None)
    out: list[dict[str, Any]] = []
    for g in listing:
        detail = described.get(g["groupId"], {})
        offsets: list[dict[str, Any]] = []
        try:
            offsets = await admin.group_offsets(g["groupId"])
        except Exception:
            offsets = []
        marks = await admin.watermarks([(o["topic"], o["partition"]) for o in offsets])
        lags = [
            (o["topic"], max(marks.get((o["topic"], o["partition"]), (0, 0))[1] - o["offset"], 0))
            for o in offsets
        ]
        lag = sum(v for _t, v in lags)
        out.append(
            {
                "groupId": g["groupId"],
                "groupType": detail.get("groupType") or g["groupType"],
                "state": detail.get("state") or g["state"],
                "protocolType": detail.get("protocolType"),
                "protocol": detail.get("protocol"),
                "coordinatorId": detail.get("coordinatorId"),
                "memberCount": len(detail.get("members", [])),
                "topicCount": len({o["topic"] for o in offsets}),
                "partitionCount": len(offsets),
                "totalLag": lag,
                "isSimple": bool(g.get("isSimple")),
                "maxTimeLagMs": _max_or_none([time_lag.ms(t, v) for t, v in lags]),
            }
        )
    return out


@router.get("/consumer-groups", response_model=list[GroupSummary] | Page[GroupSummary])
async def list_groups(
    request: Request,
    search: str | None = Query(None),
    state: str | None = Query(None),
    sort: str | None = Query(None),
    order: str = Query("asc"),
    page: int | None = Query(None, ge=1, description="1-based page; omit for the plain list"),
    perPage: int = Query(50, ge=1, le=1000, alias="perPage"),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> list[GroupSummary] | Page[GroupSummary]:
    """List consumer groups.

    Backward compatible: without ``page`` the response is the plain list. When ``page`` is given
    the response is the standard ``{items, total, page, perPage}`` envelope (same shape as
    ``/topics``), with optional ``sort``/``order`` applied before slicing.
    """
    items = await _summaries(ctx, sampler=sampler_for(request, ctx.config.id))
    if search:
        items = [g for g in items if search.lower() in g["groupId"].lower()]
    if state:
        items = [g for g in items if g["state"].lower() == state.lower()]
    items = paginate_sort(items, sort, order)
    if page is None:
        return [GroupSummary(**g) for g in items]
    total = len(items)
    start = (page - 1) * perPage
    window = items[start : start + perPage]
    return Page[GroupSummary](
        items=[GroupSummary(**g) for g in window], page=page, perPage=perPage, total=total
    )


@router.get("/share-groups")
async def list_share_groups(
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> dict[str, Any]:
    """Kafka 4.x share groups; ``{supported: false}`` when the broker/client lacks them."""
    from k_shui.kafka.admin import UnsupportedFeature

    try:
        items = await _summaries(ctx, group_types=["share"], sampler=sampler_for(request, ctx.config.id))
    except UnsupportedFeature as exc:
        return {"supported": False, "reason": exc.detail, "items": []}
    except Exception as exc:
        return {"supported": False, "reason": str(exc), "items": []}
    return {"supported": True, "items": items}


@router.get("/consumer-groups/export.csv")
async def export_groups_csv(
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> StreamingResponse:
    items = await _summaries(ctx)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["groupId", "groupType", "state", "members", "topics", "partitions", "totalLag", "coordinatorId"]
    )
    for g in items:
        writer.writerow(
            [
                g["groupId"],
                g["groupType"],
                g["state"],
                g["memberCount"],
                g["topicCount"],
                g["partitionCount"],
                g["totalLag"],
                g["coordinatorId"],
            ]
        )
    await audit(request, "consumerGroups.export", resource="consumer-groups", details={"count": len(items)})
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8")]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="consumer-groups.csv"'},
    )


@router.get("/consumer-groups/{group_id}", response_model=GroupDetail)
async def get_group(
    group_id: str,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> GroupDetail:
    admin = KafkaAdmin.get(ctx)
    described = await admin.describe_groups([group_id])
    detail = described.get(group_id)
    if detail is None or detail.get("error"):
        raise NotFound(f"consumer group '{group_id}' not found")
    offsets = await admin.group_offsets(group_id)
    marks = await admin.watermarks([(o["topic"], o["partition"]) for o in offsets])
    time_lag = _TimeLag(sampler_for(request, ctx.config.id), await admin.metadata())
    owner: dict[tuple[str, int], dict[str, Any]] = {}
    for m in detail.get("members", []):
        for a in m["assignments"]:
            owner[(a["topic"], a["partition"])] = m

    partitions: list[GroupPartition] = []
    per_topic: dict[str, list[int]] = {}
    for o in offsets:
        key = (o["topic"], o["partition"])
        low, high = marks.get(key, (0, 0))
        lag = max(high - o["offset"], 0)
        member = owner.get(key, {})
        partitions.append(
            GroupPartition(
                topic=o["topic"],
                partition=o["partition"],
                currentOffset=o["offset"],
                beginOffset=low,
                endOffset=high,
                lag=lag,
                memberId=member.get("memberId"),
                clientId=member.get("clientId"),
                host=member.get("host"),
                timeLagMs=time_lag.ms(o["topic"], lag),
            )
        )
        per_topic.setdefault(o["topic"], []).append(lag)

    return GroupDetail(
        groupId=group_id,
        groupType=detail.get("groupType", "classic"),
        state=detail.get("state", "unknown"),
        protocolType=detail.get("protocolType"),
        protocol=detail.get("protocol"),
        coordinatorId=detail.get("coordinatorId"),
        memberCount=len(detail.get("members", [])),
        topicCount=len(per_topic),
        partitionCount=len(partitions),
        totalLag=sum(p.lag for p in partitions),
        isSimple=detail.get("isSimple", False),
        maxTimeLagMs=_max_or_none([p.timeLagMs for p in partitions]),
        members=[GroupMember(**m) for m in detail.get("members", [])],
        partitions=partitions,
        topicsSummary=[
            GroupTopicSummary(topic=t, lag=sum(v), partitions=len(v)) for t, v in sorted(per_topic.items())
        ],
    )


@router.delete("/consumer-groups/{group_id}", response_model=Ack)
async def delete_group(
    group_id: str,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> Ack:
    result = await KafkaAdmin.get(ctx).delete_groups([group_id])
    entry = result[0] if result else {}
    if not entry.get("deleted"):
        raise BadRequest(entry.get("error") or f"could not delete group '{group_id}'")
    await audit(request, "consumerGroup.delete", resource=group_id)
    publish("consumerGroup.deleted", ctx.config.id, {"groupId": group_id})
    return Ack(detail=f"group '{group_id}' deleted")


@router.post("/consumer-groups/{group_id}/offsets/reset", response_model=list[ResetOffsetResult])
async def reset_offsets(
    group_id: str,
    body: ResetOffsetsRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> list[ResetOffsetResult]:
    admin = KafkaAdmin.get(ctx)
    committed = await admin.group_offsets(group_id, [body.topic] if body.topic else None)
    if body.partitions:
        committed = [c for c in committed if c["partition"] in body.partitions]
    if not committed and body.topic:
        # No committed offsets yet: seed the plan from the topic's partitions, but keep
        # honouring the caller's partition scoping instead of expanding to all of them.
        detail = await admin.describe_topic(body.topic)
        committed = [
            {"topic": body.topic, "partition": p["id"], "offset": -1}
            for p in detail["partitionsDetail"]
            if not body.partitions or p["id"] in body.partitions
        ]
    if not committed:
        raise NotFound(f"no committed offsets found for group '{group_id}'")

    keys = [(c["topic"], c["partition"]) for c in committed]
    marks = await admin.watermarks(keys)
    ts_map: dict[tuple[str, int], int] = {}
    if body.strategy == "timestamp":
        if body.value is None:
            raise BadRequest("strategy=timestamp requires a value (epoch millis)")
        ts_map = await admin.offsets_for_times([(t, p, int(body.value)) for t, p in keys])

    plan: list[ResetOffsetResult] = []
    for c in committed:
        key = (c["topic"], c["partition"])
        low, high = marks.get(key, (0, 0))
        if body.strategy == "earliest":
            new = low
        elif body.strategy == "latest":
            new = high
        elif body.strategy == "offset":
            if body.value is None:
                raise BadRequest("strategy=offset requires a value")
            new = max(low, min(int(body.value), high))
        elif body.strategy == "shiftBy":
            if body.value is None:
                raise BadRequest("strategy=shiftBy requires a value")
            new = max(low, min(max(c["offset"], 0) + int(body.value), high))
        else:  # timestamp
            resolved = ts_map.get(key, -1)
            new = high if resolved < 0 else resolved
        plan.append(
            ResetOffsetResult(
                topic=key[0],
                partition=key[1],
                oldOffset=c["offset"] if c["offset"] >= 0 else None,
                newOffset=new,
            )
        )

    if body.dryRun:
        return plan
    applied = await admin.alter_group_offsets(
        group_id, [(p.topic, p.partition, p.newOffset or 0) for p in plan]
    )
    errors = {(a["topic"], a["partition"]): a.get("error") for a in applied}
    for p in plan:
        p.error = errors.get((p.topic, p.partition))
    await audit(
        request,
        "consumerGroup.offsets.reset",
        resource=group_id,
        details={"strategy": body.strategy, "topic": body.topic, "partitions": len(plan)},
    )
    publish("consumerGroup.offsetsReset", ctx.config.id, {"groupId": group_id, "strategy": body.strategy})
    return plan


@router.delete("/consumer-groups/{group_id}/offsets", response_model=Ack)
async def delete_group_offsets(
    group_id: str,
    request: Request,
    topic: str = Query(...),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> Ack:
    await KafkaAdmin.get(ctx).delete_group_offsets(group_id, topic)
    await audit(request, "consumerGroup.offsets.delete", resource=group_id, details={"topic": topic})
    return Ack(detail=f"offsets for topic '{topic}' deleted from group '{group_id}'")


@router.get("/consumer-groups/{group_id}/lag-history", response_model=SeriesResponse)
async def lag_history(
    group_id: str,
    request: Request,
    tr: TimeRange = Depends(time_range),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> SeriesResponse:
    sampler = sampler_for(request, ctx.config.id)
    if sampler is None:
        return SeriesResponse(series=[], source="sampled")
    return SeriesResponse(series=sampler.group_lag_series(group_id, tr.start, tr.end), source="sampled")
