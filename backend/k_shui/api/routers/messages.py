"""Message browsing (SSE or JSON), producing and export."""

from __future__ import annotations

import csv
import io
from collections.abc import AsyncIterator
from typing import Any

import orjson
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from k_shui.api.schemas.topic import MessagesResponse, ProduceRequest, ProduceResponse
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_editor, require_viewer
from k_shui.core.errors import BadRequest
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.consumer import BrowseRequest, MessageBrowser
from k_shui.kafka.producer import MessageProducer

router = APIRouter(prefix="/clusters/{cluster_id}/topics/{topic}/messages", tags=["messages"])


def browse_params(
    topic: str,
    mode: str = Query(
        "latest",
        pattern="^(latest|earliest|offset|timestamp|tail)$",
        description="tail = live follow from the end (or startOffsets) until the client disconnects",
    ),
    partitions: str | None = Query(None, description="comma separated partition ids"),
    offset: int | None = Query(None),
    startOffsets: str | None = Query(
        None, description="per-partition seek for mode=offset, e.g. '0:100,1:250' (overrides offset)"
    ),
    timestamp: int | None = Query(None, description="epoch millis"),
    limit: int = Query(100, ge=1, le=10000),
    keyFormat: str = Query("auto"),
    valueFormat: str = Query("auto"),
    filter: str | None = Query(None, max_length=512),
    filterMode: str = Query("contains", pattern="^(contains|regex|jsonpath)$"),
    filterTarget: str = Query(
        "any",
        pattern="^(any|key|value|header)$",
        description="scope the filter to the key, value or headers; 'header:<name>=<value>' also works",
    ),
    includeRaw: bool = Query(False),
    timeBudget: float = Query(15.0, ge=1.0, le=120.0),
) -> BrowseRequest:
    parts: list[int] | None = None
    if partitions:
        try:
            parts = [int(p) for p in partitions.split(",") if p.strip() != ""]
        except ValueError as exc:
            raise BadRequest(f"invalid partitions '{partitions}'") from exc
    start_offsets: dict[int, int] | None = None
    if startOffsets:
        start_offsets = {}
        for pair in startOffsets.split(","):
            if pair.strip() == "":
                continue
            try:
                part_s, off_s = pair.split(":", 1)
                part_id, off = int(part_s), int(off_s)
            except ValueError as exc:
                raise BadRequest(f"invalid startOffsets '{startOffsets}'") from exc
            if off < 0:
                raise BadRequest(f"startOffsets: offset for partition {part_id} must be >= 0")
            start_offsets[part_id] = off
    return BrowseRequest(
        topic=topic,
        mode=mode,
        partitions=parts,
        offset=offset,
        start_offsets=start_offsets,
        timestamp=timestamp,
        limit=limit,
        key_format=keyFormat,
        value_format=valueFormat,
        filter=filter,
        filter_mode=filterMode,
        filter_target=filterTarget,
        include_raw=includeRaw,
        time_budget=timeBudget,
    )


@router.get("", response_model=None)
async def get_messages(
    request: Request,
    req: BrowseRequest = Depends(browse_params),
    stream: bool = Query(True),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> Any:
    browser = MessageBrowser.get(ctx)
    if not stream:
        return MessagesResponse(**await browser.collect(req))

    async def generator() -> AsyncIterator[dict[str, str]]:
        # ``browse`` closes its consumer in ``finally`` both when we break out here after a
        # disconnect and when sse-starlette cancels this generator (tail mode never ends on its own).
        async for event in browser.browse(req):
            kind = event.pop("type")
            payload = event.get("message") if kind == "message" else event
            yield {"event": kind, "data": orjson.dumps(payload).decode()}
            if await request.is_disconnected():
                break

    return EventSourceResponse(generator(), ping=15)


@router.post("", response_model=ProduceResponse, status_code=201)
async def produce_message(
    topic: str,
    body: ProduceRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> ProduceResponse:
    result = await MessageProducer.get(ctx).produce(
        topic,
        value=body.value,
        key=body.key,
        headers=body.headers,
        partition=body.partition,
        key_format=body.keyFormat,
        value_format=body.valueFormat,
        key_subject=body.keySchemaSubject,
        value_subject=body.valueSchemaSubject,
    )
    await audit(request, "message.produce", resource=topic, details={"partition": result.get("partition")})
    publish("message.produced", ctx.config.id, {"topic": topic, **result})
    return ProduceResponse(**result)


@router.get("/export")
async def export_messages(
    topic: str,
    request: Request,
    format: str = Query("json", pattern="^(json|csv|ndjson)$"),
    req: BrowseRequest = Depends(browse_params),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> StreamingResponse:
    result = await MessageBrowser.get(ctx).collect(req)
    items: list[dict[str, Any]] = result["items"]
    await audit(request, "message.export", resource=topic, details={"format": format, "count": len(items)})
    filename = f"{topic}-messages.{format}"
    if format == "json":
        body = orjson.dumps({"items": items, "scanned": result["scanned"]}, option=orjson.OPT_INDENT_2)
        media = "application/json"
    elif format == "ndjson":
        body = b"\n".join(orjson.dumps(i) for i in items)
        media = "application/x-ndjson"
    else:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["partition", "offset", "timestamp", "key", "value", "headers"])
        for m in items:
            writer.writerow(
                [
                    m["partition"],
                    m["offset"],
                    m["timestamp"],
                    _flat(m["key"]),
                    _flat(m["value"]),
                    _flat(m["headers"]),
                ]
            )
        body = buf.getvalue().encode("utf-8")
        media = "text/csv"
    return StreamingResponse(
        iter([body]), media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


def _flat(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return orjson.dumps(value).decode()
