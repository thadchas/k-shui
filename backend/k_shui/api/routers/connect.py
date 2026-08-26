"""Kafka Connect endpoints (`/clusters/{c}/connect/...`)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request

from k_shui.api.schemas.connect import (
    ConnectCluster,
    Connector,
    CreateConnectorRequest,
    OffsetsPatch,
)
from k_shui.core.auth import non_mutating, require_editor, require_viewer
from k_shui.core.errors import IntegrationNotConfigured
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.integrations.audit import audit, publish
from k_shui.integrations.connect import all_connects, get_connect

router = APIRouter(tags=["connect"], dependencies=[Depends(require_viewer)])
BASE = "/clusters/{cluster_id}/connect"
KC = BASE + "/{connect_name}"


@router.get(BASE, response_model=list[ConnectCluster])
async def list_connect_clusters(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    clients = all_connects(ctx)
    if not clients:
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no Kafka Connect configured")
    results = await asyncio.gather(*(c.cluster_summary() for c in clients), return_exceptions=True)
    rows: list[dict[str, Any]] = []
    for client, result in zip(clients, results, strict=False):
        if isinstance(result, dict):
            rows.append(result)
        else:
            rows.append({"name": client.name, "url": client.url, "status": "offline"})
    return rows


@router.get(KC + "/connectors", response_model=list[Connector])
async def list_connectors(
    connect_name: str,
    ctx: ClusterContext = Depends(get_cluster),
    search: str | None = Query(None),
    state: str | None = Query(None),
    type: str | None = Query(None),
) -> Any:
    return await get_connect(ctx, connect_name).list_connectors(search=search, state=state, type_=type)


@router.post(
    KC + "/connectors", response_model=Connector, status_code=201, dependencies=[Depends(require_editor)]
)
async def create_connector(
    request: Request,
    connect_name: str,
    body: CreateConnectorRequest,
    ctx: ClusterContext = Depends(get_cluster),
) -> Any:
    client = get_connect(ctx, connect_name)
    await client.create(body.name, body.config)
    await audit(request, "connector.create", f"connect/{connect_name}/{body.name}", {"config": body.config})
    await publish("connector.created", ctx.id, {"connect": connect_name, "name": body.name})
    return await client.connector(body.name)


@router.get(KC + "/connectors/{name}", response_model=Connector)
async def get_connector(connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_connect(ctx, connect_name).connector(name)


@router.delete(KC + "/connectors/{name}", status_code=204, dependencies=[Depends(require_editor)])
async def delete_connector(
    request: Request, connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> None:
    await get_connect(ctx, connect_name).delete(name)
    await audit(request, "connector.delete", f"connect/{connect_name}/{name}", {})
    await publish("connector.deleted", ctx.id, {"connect": connect_name, "name": name})


@router.get(KC + "/connectors/{name}/config")
async def get_connector_config(
    connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_connect(ctx, connect_name).get_config(name)


@router.put(
    KC + "/connectors/{name}/config", response_model=Connector, dependencies=[Depends(require_editor)]
)
async def put_connector_config(
    request: Request,
    connect_name: str,
    name: str,
    config: dict[str, Any] = Body(...),
    ctx: ClusterContext = Depends(get_cluster),
) -> Any:
    client = get_connect(ctx, connect_name)
    await client.put_config(name, config)
    await audit(request, "connector.config.update", f"connect/{connect_name}/{name}", {"config": config})
    return await client.connector(name)


@router.get(KC + "/connectors/{name}/status")
async def connector_status(
    connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_connect(ctx, connect_name).status(name)


@router.get(KC + "/connectors/{name}/tasks")
async def connector_tasks(
    connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> list[dict[str, Any]]:
    return await get_connect(ctx, connect_name).tasks(name)


@router.post(KC + "/connectors/{name}/{action}", dependencies=[Depends(require_editor)])
async def connector_action(
    request: Request,
    connect_name: str,
    name: str,
    action: str,
    ctx: ClusterContext = Depends(get_cluster),
    includeTasks: bool = Query(False),
    onlyFailed: bool = Query(False),
) -> dict[str, Any]:
    """``pause`` | ``resume`` | ``stop`` | ``restart`` on a connector."""
    from k_shui.core.errors import BadRequest

    client = get_connect(ctx, connect_name)
    result: dict[str, Any] = {"name": name, "action": action, "ok": True}
    if action == "pause":
        await client.pause(name)
    elif action == "resume":
        await client.resume(name)
    elif action == "stop":
        await client.stop(name)
    elif action == "restart":
        result.update(await client.restart(name, include_tasks=includeTasks, only_failed=onlyFailed))
        result.setdefault("ok", True)
    else:
        raise BadRequest(f"unsupported connector action '{action}'")
    await audit(request, f"connector.{action}", f"connect/{connect_name}/{name}", {})
    await publish(f"connector.{action}", ctx.id, {"connect": connect_name, "name": name})
    return result


@router.post(
    KC + "/connectors/{name}/tasks/{task_id}/restart", status_code=204, dependencies=[Depends(require_editor)]
)
async def restart_task(
    request: Request, connect_name: str, name: str, task_id: int, ctx: ClusterContext = Depends(get_cluster)
) -> None:
    await get_connect(ctx, connect_name).restart_task(name, task_id)
    await audit(request, "connector.task.restart", f"connect/{connect_name}/{name}/{task_id}", {})


@router.get(KC + "/connectors/{name}/topics")
async def connector_topics(
    connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    topics = await get_connect(ctx, connect_name).topics(name)
    return {"name": name, "topics": topics}


@router.put(KC + "/connectors/{name}/topics/reset", status_code=204, dependencies=[Depends(require_editor)])
async def reset_connector_topics(
    request: Request, connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> None:
    await get_connect(ctx, connect_name).reset_topics(name)
    await audit(request, "connector.topics.reset", f"connect/{connect_name}/{name}", {})


@router.get(KC + "/connectors/{name}/offsets")
async def get_offsets(
    connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_connect(ctx, connect_name).offsets(name)


@router.patch(KC + "/connectors/{name}/offsets", dependencies=[Depends(require_editor)])
async def patch_offsets(
    request: Request,
    connect_name: str,
    name: str,
    body: OffsetsPatch,
    ctx: ClusterContext = Depends(get_cluster),
) -> dict[str, Any]:
    result = await get_connect(ctx, connect_name).patch_offsets(name, body.offsets)
    await audit(request, "connector.offsets.patch", f"connect/{connect_name}/{name}", {})
    return result


@router.delete(KC + "/connectors/{name}/offsets", dependencies=[Depends(require_editor)])
async def delete_offsets(
    request: Request, connect_name: str, name: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    result = await get_connect(ctx, connect_name).delete_offsets(name)
    await audit(request, "connector.offsets.delete", f"connect/{connect_name}/{name}", {})
    return result


@router.get(KC + "/plugins")
async def list_plugins(connect_name: str, ctx: ClusterContext = Depends(get_cluster)) -> list[dict[str, Any]]:
    return await get_connect(ctx, connect_name).plugins()


@router.put(KC + "/plugins/{plugin_class}/validate")
@non_mutating
async def validate_plugin(
    connect_name: str,
    plugin_class: str,
    config: dict[str, Any] = Body(...),
    ctx: ClusterContext = Depends(get_cluster),
) -> dict[str, Any]:
    return await get_connect(ctx, connect_name).validate(plugin_class, config)


@router.get(KC + "/metrics")
async def connect_metrics(
    connect_name: str,
    ctx: ClusterContext = Depends(get_cluster),
    range: str = Query("1h"),
    step: str | None = Query(None),
) -> dict[str, Any]:
    from k_shui.integrations.prometheus import connect_series

    return await connect_series(ctx, connect_name, range, step)
