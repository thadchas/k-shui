"""User dashboard persistence (SQLite/Postgres via SQLAlchemy, in-memory fallback)."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from k_shui.core.errors import NotFound
from k_shui.core.registry import ClusterContext
from k_shui.integrations import store as shared_store
from k_shui.integrations.dashboards import builtin as builtin_dashboards
from k_shui.integrations.dashboards.grafana import slugify
from k_shui.integrations.memstore import dashboard_table
from k_shui.integrations.prometheus import auto_step, parse_range, to_series, try_prometheus

SPEC_KEYS = ("description", "tags", "variables", "rows")


def _spec(dashboard: dict[str, Any]) -> dict[str, Any]:
    return {k: dashboard.get(k) for k in SPEC_KEYS if dashboard.get(k) is not None}


def _row(model: Any) -> dict[str, Any]:
    if hasattr(model, "to_dict"):
        return dict(model.to_dict())
    spec = getattr(model, "spec", None) or {}
    return {
        "id": model.id,
        "clusterId": getattr(model, "cluster_id", None),
        "title": model.title,
        "builtin": False,
        **spec,
    }


async def _db_session() -> Any:
    """The shared DB session context manager, or ``None`` when there is no database."""
    return shared_store.session_scope()


async def list_user(cluster_id: str) -> list[dict[str, Any]]:
    scope = await _db_session()
    if scope is None:
        return dashboard_table(cluster_id).list()
    try:
        from sqlalchemy import or_, select

        from k_shui.db.models import Dashboard

        async with scope() as session:
            stmt = select(Dashboard).where(
                or_(Dashboard.cluster_id == cluster_id, Dashboard.cluster_id.is_(None))
            )
            return [_row(m) for m in (await session.execute(stmt)).scalars().all()]
    except Exception:
        return dashboard_table(cluster_id).list()


async def get_user(cluster_id: str, dashboard_id: str) -> dict[str, Any] | None:
    scope = await _db_session()
    if scope is None:
        return dashboard_table(cluster_id).get(dashboard_id)
    try:
        from k_shui.db.models import Dashboard

        async with scope() as session:
            model = await session.get(Dashboard, dashboard_id)
            return _row(model) if model is not None else None
    except Exception:
        return dashboard_table(cluster_id).get(dashboard_id)


async def save_user(
    cluster_id: str, dashboard: dict[str, Any], created_by: str | None = None
) -> dict[str, Any]:
    dashboard = dict(dashboard)
    dashboard.setdefault("id", slugify(str(dashboard.get("title", "dashboard"))))
    dashboard["id"] = str(dashboard["id"])
    dashboard["clusterId"] = cluster_id
    dashboard["builtin"] = False
    dashboard.setdefault("updatedAt", time.time())
    scope = await _db_session()
    if scope is None:
        return dashboard_table(cluster_id).put(dashboard)
    try:
        from k_shui.db.models import Dashboard

        async with scope() as session:
            model = await session.get(Dashboard, dashboard["id"])
            if model is None:
                model = Dashboard(id=dashboard["id"], cluster_id=cluster_id, created_by=created_by)
                session.add(model)
            model.cluster_id = cluster_id
            model.title = dashboard.get("title", model.title or dashboard["id"])
            model.spec = _spec(dashboard)
        return await get_user(cluster_id, dashboard["id"]) or dashboard
    except Exception:
        return dashboard_table(cluster_id).put(dashboard)


async def delete_user(cluster_id: str, dashboard_id: str) -> bool:
    scope = await _db_session()
    if scope is None:
        return dashboard_table(cluster_id).delete(dashboard_id)
    try:
        from k_shui.db.models import Dashboard

        async with scope() as session:
            model = await session.get(Dashboard, dashboard_id)
            if model is None:
                return False
            await session.delete(model)
            return True
    except Exception:
        return dashboard_table(cluster_id).delete(dashboard_id)


async def list_all(cluster_id: str) -> list[dict[str, Any]]:
    """Built-in dashboards first, then this cluster's user dashboards."""
    user = await list_user(cluster_id)
    return builtin_dashboards.list_builtin() + [
        {
            "id": d.get("id"),
            "title": d.get("title", d.get("id")),
            "description": d.get("description", ""),
            "tags": d.get("tags", []),
            "builtin": False,
            "panelCount": sum(len(r.get("panels", [])) for r in d.get("rows", [])),
        }
        for d in user
    ]


async def resolve(cluster_id: str, dashboard_id: str) -> dict[str, Any]:
    builtin = builtin_dashboards.get_builtin(dashboard_id)
    if builtin is not None:
        return builtin
    user = await get_user(cluster_id, dashboard_id)
    if user is None:
        raise NotFound(f"dashboard '{dashboard_id}' not found")
    return user


async def evaluate(
    ctx: ClusterContext,
    dashboard: dict[str, Any],
    range_: str = "1h",
    step: str | None = None,
    variables: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Run every panel query concurrently via ``query_range``."""
    client = try_prometheus(ctx)
    panels = builtin_dashboards.iter_panels(dashboard)
    if client is None:
        return {
            "configured": False,
            "panels": {p["id"]: {"series": [], "error": "prometheus not configured"} for p in panels},
        }
    seconds = parse_range(range_)
    chosen = step or auto_step(seconds)
    end = time.time()
    start = end - seconds

    jobs: list[tuple[str, str | None, Any]] = []
    for panel in panels:
        for query in panel.get("queries", []):
            jobs.append(
                (
                    panel["id"],
                    query.get("legend"),
                    client.query_range(query["expr"], start, end, chosen, variables),
                )
            )
    results = await asyncio.gather(*(job[2] for job in jobs), return_exceptions=True)

    out: dict[str, Any] = {p["id"]: {"series": []} for p in panels}
    for (panel_id, legend, _), result in zip(jobs, results, strict=False):
        if isinstance(result, BaseException):
            out[panel_id].setdefault("error", str(result))
            continue
        out[panel_id]["series"].extend(to_series(result.get("result", []), legend))
    return {
        "configured": True,
        "id": dashboard.get("id"),
        "range": range_,
        "step": chosen,
        "start": int(start * 1000),
        "end": int(end * 1000),
        "panels": out,
    }
