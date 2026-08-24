"""ksqlDB endpoints (`/clusters/{c}/ksql/...`)."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from k_shui.api.schemas.ksql import (
    KsqlCloseQueryRequest,
    KsqlHistoryEntry,
    KsqlQuery,
    KsqlRequest,
    KsqlServer,
    KsqlSource,
)
from k_shui.core.errors import IntegrationNotConfigured
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.integrations.audit import audit
from k_shui.integrations.ksql import all_ksql, get_ksql
from k_shui.integrations.memstore import ksql_ring, next_id

router = APIRouter(tags=["ksql"])
BASE = "/clusters/{cluster_id}/ksql"
KS = BASE + "/{ksql_name}"


def _record_history(
    ctx: ClusterContext, name: str, sql: str, kind: str, ok: bool, error: str | None
) -> dict[str, Any]:
    entry = {
        "id": next_id("ksqlh"),
        "sql": sql,
        "server": name,
        "clusterId": ctx.id,
        "user": None,
        "ts": time.time(),
        "kind": kind,
        "ok": ok,
        "error": error,
    }
    ksql_ring(f"{ctx.id}/{name}").add(entry)
    return entry


@router.get(BASE, response_model=list[KsqlServer])
async def list_servers(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    clients = all_ksql(ctx)
    if not clients:
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no ksqlDB configured")
    results = await asyncio.gather(*(c.info() for c in clients), return_exceptions=True)
    rows: list[dict[str, Any]] = []
    for client, result in zip(clients, results, strict=False):
        if isinstance(result, dict):
            rows.append(result)
        else:
            rows.append(
                {"name": client.name, "url": client.url, "serverStatus": "UNREACHABLE", "healthy": False}
            )
    return rows


@router.get(KS + "/info", response_model=KsqlServer)
async def server_info(ksql_name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_ksql(ctx, ksql_name).info()


@router.post(KS + "/statement")
async def run_statement(
    request: Request, ksql_name: str, body: KsqlRequest, ctx: ClusterContext = Depends(get_cluster)
) -> list[dict[str, Any]]:
    client = get_ksql(ctx, ksql_name)
    try:
        result = await client.statement(body.sql, body.properties)
    except Exception as exc:
        _record_history(ctx, ksql_name, body.sql, "statement", False, str(exc))
        raise
    _record_history(ctx, ksql_name, body.sql, "statement", True, None)
    await audit(request, "ksql.statement", f"ksql/{ksql_name}", {"sql": body.sql})
    return result


@router.post(KS + "/query")
async def run_query(
    request: Request, ksql_name: str, body: KsqlRequest, ctx: ClusterContext = Depends(get_cluster)
) -> StreamingResponse:
    """Streaming push/pull query as SSE events: ``header``, ``row``, ``error``, ``end``."""
    client = get_ksql(ctx, ksql_name)
    _record_history(ctx, ksql_name, body.sql, "query", True, None)
    await audit(request, "ksql.query", f"ksql/{ksql_name}", {"sql": body.sql})

    async def gen() -> AsyncIterator[bytes]:
        try:
            async for event in client.query_stream(body.sql, body.properties):
                event_type = event.pop("type", "row")
                yield f"event: {event_type}\ndata: {json.dumps(event, default=str)}\n\n".encode()
        except Exception as exc:  # pragma: no cover - defensive
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n".encode()
            yield b"event: end\ndata: {}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(KS + "/streams", response_model=list[KsqlSource])
async def list_streams(ksql_name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_ksql(ctx, ksql_name).streams()


@router.get(KS + "/tables", response_model=list[KsqlSource])
async def list_tables(ksql_name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_ksql(ctx, ksql_name).tables()


@router.get(KS + "/queries", response_model=list[KsqlQuery])
async def list_queries(ksql_name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_ksql(ctx, ksql_name).queries()


@router.delete(KS + "/queries/{query_id}")
async def terminate_query(
    request: Request, ksql_name: str, query_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    result = await get_ksql(ctx, ksql_name).terminate(query_id)
    await audit(request, "ksql.terminate", f"ksql/{ksql_name}/{query_id}", {})
    return {"queryId": query_id, "terminated": True, "result": result}


@router.post(KS + "/close-query")
async def close_query(
    request: Request, ksql_name: str, body: KsqlCloseQueryRequest, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    """Close a transient push query (``/close-query``) — persistent queries use TERMINATE."""
    result = await get_ksql(ctx, ksql_name).close_query(body.queryId)
    await audit(request, "ksql.close_query", f"ksql/{ksql_name}/{body.queryId}", {})
    return result


@router.get(KS + "/streams/{name}")
async def describe_stream(
    ksql_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_ksql(ctx, ksql_name).describe(name)


@router.get(KS + "/tables/{name}")
async def describe_table(
    ksql_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_ksql(ctx, ksql_name).describe(name)


@router.get(KS + "/history", response_model=list[KsqlHistoryEntry])
async def history(
    ksql_name: str, ctx: ClusterContext = Depends(get_cluster), limit: int = Query(50, le=200)
) -> Any:
    return ksql_ring(f"{ctx.id}/{ksql_name}").all()[:limit]
