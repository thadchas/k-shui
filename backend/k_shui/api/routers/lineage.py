"""Stream lineage endpoints (`/clusters/{c}/lineage/...` and `/lineage/openlineage`)."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request

from k_shui.api.schemas.lineage import (
    LineageGraph,
    LineageNodeDetail,
    OpenLineageResult,
)
from k_shui.core.errors import NotFound
from k_shui.core.registry import ClusterContext, ClusterRegistry, get_cluster, get_registry
from k_shui.integrations.audit import audit
from k_shui.integrations.lineage import get_marquez, try_marquez
from k_shui.integrations.lineage_builder import ALL_SOURCES, build
from k_shui.integrations.memstore import openlineage_events

router = APIRouter(tags=["lineage"])
BASE = "/clusters/{cluster_id}/lineage"


def _sources(raw: str | None) -> list[str]:
    if not raw:
        return list(ALL_SOURCES)
    wanted = [s.strip() for s in raw.split(",") if s.strip()]
    return [s for s in wanted if s in ALL_SOURCES] or list(ALL_SOURCES)


@router.get(BASE + "/graph", response_model=LineageGraph)
async def graph(
    ctx: ClusterContext = Depends(get_cluster),
    focus: str | None = Query(None),
    depth: int = Query(3, ge=1, le=10),
    sources: str | None = Query(None),
) -> Any:
    built = await build(ctx, _sources(sources))
    return built.bfs(focus, depth) if focus else built.result()


@router.get(BASE + "/nodes/{node_id:path}", response_model=LineageNodeDetail)
async def node_detail(
    node_id: str, ctx: ClusterContext = Depends(get_cluster), sources: str | None = Query(None)
) -> Any:
    built = await build(ctx, _sources(sources))
    node = built.nodes.get(node_id)
    if node is None:
        raise NotFound(f"lineage node '{node_id}' not found")
    detail: dict[str, Any] = {
        **node,
        "upstream": [e["source"] for e in built.edges.values() if e["target"] == node_id],
        "downstream": [e["target"] for e in built.edges.values() if e["source"] == node_id],
        "latestRuns": [],
        "facets": {},
        "schemaFields": [],
    }
    client = try_marquez(ctx)
    if client is not None and node["type"] in ("job", "flinkJob"):
        namespace = node.get("namespace") or "default"
        runs = await client.runs(namespace, node["label"])
        detail["latestRuns"] = runs
    if client is not None and node["type"] in ("topic", "dataset"):
        for namespace in await client.all_namespaces():
            dataset = await client.dataset(namespace, node["label"])
            if dataset:
                detail["facets"] = dataset.get("facets", {})
                detail["schemaFields"] = dataset.get("fields", [])
                detail["namespace"] = namespace
                break
    return detail


@router.get(BASE + "/search")
async def search(
    ctx: ClusterContext = Depends(get_cluster),
    q: str = Query(..., min_length=1),
    limit: int = Query(50, le=200),
) -> dict[str, Any]:
    client = try_marquez(ctx)
    remote = await client.search(q, limit) if client is not None else []
    built = await build(ctx)
    needle = q.lower()
    local = [
        {"type": n["type"], "id": n["id"], "name": n["label"], "namespace": n.get("namespace")}
        for n in built.nodes.values()
        if needle in n["label"].lower()
    ][:limit]
    return {"query": q, "results": local, "marquez": remote}


@router.get(BASE + "/namespaces")
async def namespaces(ctx: ClusterContext = Depends(get_cluster)) -> list[dict[str, Any]]:
    return await get_marquez(ctx).namespaces()


@router.get(BASE + "/datasets")
async def datasets(
    ctx: ClusterContext = Depends(get_cluster),
    namespace: str | None = Query(None),
    limit: int = Query(100, le=500),
) -> list[dict[str, Any]]:
    client = get_marquez(ctx)
    targets = [namespace] if namespace else await client.all_namespaces()
    out: list[dict[str, Any]] = []
    for ns in targets:
        for dataset in await client.datasets(str(ns), limit):
            dataset.setdefault("namespace", ns)
            out.append(dataset)
    return out


@router.get(BASE + "/jobs")
async def jobs(
    ctx: ClusterContext = Depends(get_cluster),
    namespace: str | None = Query(None),
    limit: int = Query(100, le=500),
) -> list[dict[str, Any]]:
    client = get_marquez(ctx)
    targets = [namespace] if namespace else await client.all_namespaces()
    out: list[dict[str, Any]] = []
    for ns in targets:
        for job in await client.jobs(str(ns), limit):
            job.setdefault("namespace", ns)
            out.append(job)
    return out


@router.get(BASE + "/runs")
async def runs(
    ctx: ClusterContext = Depends(get_cluster),
    jobId: str = Query(..., description="`job:<namespace>:<name>` or a bare job name"),
    namespace: str | None = Query(None),
    limit: int = Query(20, le=100),
) -> list[dict[str, Any]]:
    client = get_marquez(ctx)
    if jobId.startswith("job:"):
        _, _, rest = jobId.partition(":")
        namespace, _, name = rest.rpartition(":")
    else:
        name = jobId
    if not namespace:
        namespace = (await client.all_namespaces() or ["default"])[0]
    return await client.runs(namespace, name, limit)


@router.get(BASE + "/marquez")
async def marquez_graph(
    ctx: ClusterContext = Depends(get_cluster),
    nodeId: str = Query(...),
    depth: int = Query(3, ge=1, le=10),
) -> dict[str, Any]:
    """Raw Marquez lineage graph for one node (unmerged)."""
    return {"graph": await get_marquez(ctx).lineage(nodeId, depth)}


@router.post("/lineage/openlineage", response_model=OpenLineageResult, status_code=202)
async def ingest_openlineage(
    request: Request,
    event: dict[str, Any] = Body(...),
    clusterId: str | None = Query(None),
    registry: ClusterRegistry = Depends(get_registry),
) -> Any:
    """Forward an OpenLineage event to Marquez; store it in a local ring when unconfigured."""
    contexts = [registry.get(clusterId)] if clusterId else registry.all()
    for ctx in contexts:
        if ctx is None:
            continue
        client = try_marquez(ctx)
        if client is None:
            continue
        result = await client.ingest(event)
        await audit(request, "lineage.openlineage", "lineage", {"job": event.get("job")}, ctx.id)
        return {"accepted": bool(result["accepted"]), "forwarded": True, "status": result["status"]}
    openlineage_events.add({"ts": time.time(), "event": event})
    await audit(request, "lineage.openlineage", "lineage", {"stored": True}, clusterId)
    return {"accepted": True, "forwarded": False, "stored": len(openlineage_events)}


@router.get("/lineage/openlineage")
async def stored_openlineage(limit: int = Query(100, le=1000)) -> dict[str, Any]:
    """Events buffered locally because no Marquez backend is configured."""
    return {"items": openlineage_events.all()[:limit], "total": len(openlineage_events)}
