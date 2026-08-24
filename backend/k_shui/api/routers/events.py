"""Server-sent events stream."""

from __future__ import annotations

from collections.abc import AsyncIterator

import orjson
from fastapi import APIRouter, Depends, Query, Request
from sse_starlette.sse import EventSourceResponse

from k_shui.core.auth import Principal, require_viewer
from k_shui.core.events import get_bus

router = APIRouter(tags=["events"])


@router.get("/events")
async def events(
    request: Request,
    types: str | None = Query(None, description="comma-separated event types"),
    clusterId: str | None = Query(None),
    principal: Principal = Depends(require_viewer),
) -> EventSourceResponse:
    wanted = {t.strip() for t in types.split(",") if t.strip()} if types else None
    bus = get_bus()

    async def generator() -> AsyncIterator[dict[str, str]]:
        for evt in bus.recent(20):
            if wanted and evt["type"] not in wanted:
                continue
            yield {"event": evt["type"], "data": orjson.dumps(evt).decode()}
        async for evt in bus.stream(wanted, clusterId):
            if await request.is_disconnected():
                break
            yield {"event": evt["type"], "data": orjson.dumps(evt).decode()}

    return EventSourceResponse(generator(), ping=20)
