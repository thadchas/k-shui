"""Prometheus metrics + dashboard endpoints (`/clusters/{c}/metrics/...`)."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request

from k_shui.api.schemas.metrics import (
    CatalogEntry,
    Dashboard,
    DashboardData,
    DashboardSummary,
    DashboardWrite,
    MetricsStatus,
    QueryResult,
)
from k_shui.core.errors import BadRequest, NotFound
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.integrations.audit import audit
from k_shui.integrations.dashboards import builtin as builtin_dashboards
from k_shui.integrations.dashboards import store as dashboards
from k_shui.integrations.dashboards.grafana import convert as convert_grafana
from k_shui.integrations.prometheus import (
    auto_step,
    get_prometheus,
    parse_range,
    to_series,
    try_prometheus,
)

router = APIRouter(tags=["metrics"])
BASE = "/clusters/{cluster_id}/metrics"


@router.get(BASE + "/status", response_model=MetricsStatus)
async def status(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    client = try_prometheus(ctx)
    if client is None:
        return {"configured": False, "url": None, "reachable": False, "targets": []}
    return await client.status()


@router.get(BASE + "/query", response_model=QueryResult)
async def query(
    ctx: ClusterContext = Depends(get_cluster),
    query: str = Query(..., min_length=1),
    time_: float | None = Query(None, alias="time"),
) -> Any:
    return await get_prometheus(ctx).query(query, time_)


@router.get(BASE + "/query_range", response_model=QueryResult)
async def query_range(
    ctx: ClusterContext = Depends(get_cluster),
    query: str = Query(..., min_length=1),
    start: float | None = Query(None),
    end: float | None = Query(None),
    step: str | None = Query(None),
    range: str | None = Query(None),
) -> Any:
    seconds = parse_range(range)
    now = time.time()
    end_ts = end if end is not None else now
    start_ts = start if start is not None else end_ts - seconds
    if end_ts <= start_ts:
        raise BadRequest("end must be after start")
    return await get_prometheus(ctx).query_range(
        query, start_ts, end_ts, step or auto_step(int(end_ts - start_ts))
    )


@router.get(BASE + "/series")
async def series(
    ctx: ClusterContext = Depends(get_cluster),
    query: str = Query(..., min_length=1),
    range: str = Query("1h"),
    step: str | None = Query(None),
    legend: str | None = Query(None),
) -> dict[str, Any]:
    """Range query already shaped as the contract's ``{series:[…]}`` payload."""
    client = get_prometheus(ctx)
    seconds = parse_range(range)
    chosen = step or auto_step(seconds)
    end = time.time()
    result = await client.query_range(query, end - seconds, end, chosen)
    return {"range": range, "step": chosen, "series": to_series(result["result"], legend)}


@router.get(BASE + "/catalog", response_model=list[CatalogEntry])
async def catalog(
    ctx: ClusterContext = Depends(get_cluster),
    search: str | None = Query(None),
    limit: int = Query(500, le=5000),
) -> Any:
    return await get_prometheus(ctx).catalog(search=search, limit=limit)


@router.get(BASE + "/labels/{label}/values")
async def label_values(
    label: str, ctx: ClusterContext = Depends(get_cluster), match: str | None = Query(None)
) -> list[str]:
    return await get_prometheus(ctx).label_values(label, match)


@router.get(BASE + "/dashboards", response_model=list[DashboardSummary])
async def list_dashboards(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await dashboards.list_all(ctx.id)


@router.post(BASE + "/dashboards", response_model=Dashboard, status_code=201)
async def create_dashboard(
    request: Request, body: DashboardWrite, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    saved = await dashboards.save_user(ctx.id, body.model_dump(exclude_none=True))
    await audit(request, "dashboard.create", f"metrics/dashboards/{saved.get('id')}", {})
    return saved


@router.post(BASE + "/dashboards/import", response_model=Dashboard, status_code=201)
async def import_dashboard(
    request: Request,
    payload: dict[str, Any] = Body(...),
    ctx: ClusterContext = Depends(get_cluster),
    id: str | None = Query(None),
) -> Any:
    converted = convert_grafana(payload, id)
    if not converted["rows"]:
        raise BadRequest("no convertible panels found in the Grafana dashboard")
    saved = await dashboards.save_user(ctx.id, converted)
    await audit(request, "dashboard.import", f"metrics/dashboards/{saved.get('id')}", {})
    return saved


@router.get(BASE + "/dashboards/{dashboard_id}", response_model=Dashboard)
async def get_dashboard(dashboard_id: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await dashboards.resolve(ctx.id, dashboard_id)


@router.put(BASE + "/dashboards/{dashboard_id}", response_model=Dashboard)
async def update_dashboard(
    request: Request,
    dashboard_id: str,
    body: DashboardWrite,
    ctx: ClusterContext = Depends(get_cluster),
) -> Any:
    if builtin_dashboards.get_builtin(dashboard_id) is not None:
        raise BadRequest(f"dashboard '{dashboard_id}' is built in and cannot be modified")
    payload = body.model_dump(exclude_none=True)
    payload["id"] = dashboard_id
    saved = await dashboards.save_user(ctx.id, payload)
    await audit(request, "dashboard.update", f"metrics/dashboards/{dashboard_id}", {})
    return saved


@router.delete(BASE + "/dashboards/{dashboard_id}", status_code=204)
async def delete_dashboard(
    request: Request, dashboard_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> None:
    if builtin_dashboards.get_builtin(dashboard_id) is not None:
        raise BadRequest(f"dashboard '{dashboard_id}' is built in and cannot be deleted")
    if not await dashboards.delete_user(ctx.id, dashboard_id):
        raise NotFound(f"dashboard '{dashboard_id}' not found")
    await audit(request, "dashboard.delete", f"metrics/dashboards/{dashboard_id}", {})


@router.get(BASE + "/dashboards/{dashboard_id}/data", response_model=DashboardData)
async def dashboard_data(
    dashboard_id: str,
    ctx: ClusterContext = Depends(get_cluster),
    range: str = Query("1h"),
    step: str | None = Query(None),
    vars: str | None = Query(None),
) -> Any:
    dashboard = await dashboards.resolve(ctx.id, dashboard_id)
    variables: dict[str, str] = {}
    for pair in (vars or "").split(","):
        if "=" in pair:
            key, _, value = pair.partition("=")
            variables[key.strip()] = value.strip()
    return await dashboards.evaluate(ctx, dashboard, range, step, variables)
