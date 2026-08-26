"""Flink endpoints (`/clusters/{c}/flink/...`) — a normalised proxy to the Flink REST API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse

from k_shui.api.schemas.flink import (
    FlinkCluster,
    FlinkJob,
    RunJarRequest,
    SavepointRequest,
    SqlSessionRequest,
    SqlStatementRequest,
)
from k_shui.config import Settings
from k_shui.core.auth import Principal, enforce_mutation, non_mutating, require_editor, require_viewer
from k_shui.core.errors import IntegrationNotConfigured
from k_shui.core.registry import ClusterContext, get_cluster, get_settings
from k_shui.core.sqlguard import FLINK_READ_ONLY, is_read_only_sql
from k_shui.integrations.audit import audit, publish
from k_shui.integrations.flink import all_flink, flink_summaries, get_flink

router = APIRouter(tags=["flink"], dependencies=[Depends(require_viewer)])
BASE = "/clusters/{cluster_id}/flink"
FC = BASE + "/{flink_name}"


@router.get(BASE, response_model=list[FlinkCluster])
async def list_flink_clusters(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    if not all_flink(ctx):
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no Flink configured")
    return await flink_summaries(ctx)


@router.get(FC + "/overview")
async def overview(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).overview()


@router.get(FC + "/config")
async def cluster_config(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).cluster_config()


@router.get(FC + "/jobs", response_model=list[FlinkJob])
async def jobs(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_flink(ctx, flink_name).jobs()


@router.get(FC + "/jobs/{jid}")
async def job_detail(flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    job = await client.job(jid)
    job.setdefault("plan", {})
    return job


@router.get(FC + "/jobs/{jid}/plan")
async def job_plan(flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).job_plan(jid)


@router.get(FC + "/jobs/{jid}/config")
async def job_config(flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).job_config(jid)


@router.get(FC + "/jobs/{jid}/checkpoints")
async def checkpoints(
    flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).checkpoints(jid)


@router.get(FC + "/jobs/{jid}/checkpoints/config")
async def checkpoint_config(
    flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).checkpoint_config(jid)


@router.get(FC + "/jobs/{jid}/checkpoints/details/{checkpoint_id}")
async def checkpoint_detail(
    flink_name: str, jid: str, checkpoint_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).checkpoint_detail(jid, checkpoint_id)


@router.get(FC + "/jobs/{jid}/exceptions")
async def exceptions(
    flink_name: str,
    jid: str,
    ctx: ClusterContext = Depends(get_cluster),
    maxExceptions: int = Query(20, le=200),
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).exceptions(jid, maxExceptions)


@router.get(FC + "/jobs/{jid}/accumulators")
async def accumulators(
    flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).accumulators(jid)


@router.get(FC + "/jobs/{jid}/metrics")
async def job_metrics(
    flink_name: str, jid: str, ctx: ClusterContext = Depends(get_cluster), get: str | None = Query(None)
) -> Any:
    return await get_flink(ctx, flink_name).job_metrics(jid, get)


@router.get(FC + "/jobs/{jid}/vertices/{vertex_id}")
async def vertex(
    flink_name: str, jid: str, vertex_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).vertex(jid, vertex_id)


@router.get(FC + "/jobs/{jid}/vertices/{vertex_id}/subtasks")
async def subtasks(
    flink_name: str, jid: str, vertex_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    detail = await client.vertex(jid, vertex_id)
    times = await client.subtask_times(jid, vertex_id)
    return {
        "id": vertex_id,
        "name": detail.get("name"),
        "parallelism": detail.get("parallelism"),
        "subtasks": detail.get("subtasks", []),
        "times": times.get("subtasks", []),
    }


@router.get(FC + "/jobs/{jid}/vertices/{vertex_id}/backpressure")
async def backpressure(
    flink_name: str, jid: str, vertex_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).backpressure(jid, vertex_id)


@router.get(FC + "/jobs/{jid}/vertices/{vertex_id}/watermarks")
async def watermarks(
    flink_name: str, jid: str, vertex_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    return await get_flink(ctx, flink_name).watermarks(jid, vertex_id)


@router.get(FC + "/jobs/{jid}/vertices/{vertex_id}/metrics")
async def vertex_metrics(
    flink_name: str,
    jid: str,
    vertex_id: str,
    ctx: ClusterContext = Depends(get_cluster),
    get: str | None = Query(None),
) -> Any:
    return await get_flink(ctx, flink_name).vertex_metrics(jid, vertex_id, get)


@router.patch(FC + "/jobs/{jid}", dependencies=[Depends(require_editor)])
async def cancel_job(
    request: Request,
    flink_name: str,
    jid: str,
    ctx: ClusterContext = Depends(get_cluster),
    mode: str = Query("cancel", pattern="^(cancel|stop)$"),
) -> dict[str, Any]:
    result = await get_flink(ctx, flink_name).cancel(jid, mode)
    await audit(request, f"flink.job.{mode}", f"flink/{flink_name}/{jid}", {})
    await publish("flink.job.cancelled", ctx.id, {"flink": flink_name, "jid": jid, "mode": mode})
    return result


@router.post(FC + "/jobs/{jid}/savepoints", dependencies=[Depends(require_editor)])
async def trigger_savepoint(
    request: Request,
    flink_name: str,
    jid: str,
    body: SavepointRequest,
    ctx: ClusterContext = Depends(get_cluster),
) -> dict[str, Any]:
    result = await get_flink(ctx, flink_name).trigger_savepoint(
        jid, body.targetDirectory, body.cancelJob, body.drain
    )
    await audit(request, "flink.savepoint", f"flink/{flink_name}/{jid}", {"cancelJob": body.cancelJob})
    return result


@router.get(FC + "/jobs/{jid}/savepoints/{trigger_id}")
async def savepoint_status(
    flink_name: str, jid: str, trigger_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).savepoint_status(jid, trigger_id)


@router.get(FC + "/taskmanagers")
async def taskmanagers(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> list[dict[str, Any]]:
    return await get_flink(ctx, flink_name).taskmanagers()


@router.get(FC + "/taskmanagers/{tm_id}")
async def taskmanager(
    flink_name: str, tm_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).taskmanager(tm_id)


@router.get(FC + "/taskmanagers/{tm_id}/logs")
async def taskmanager_logs(
    flink_name: str,
    tm_id: str,
    ctx: ClusterContext = Depends(get_cluster),
    file: str | None = Query(None),
) -> Any:
    client = get_flink(ctx, flink_name)
    if file:
        return PlainTextResponse(await client.taskmanager_log(tm_id, file))
    return await client.taskmanager_logs(tm_id)


@router.get(FC + "/taskmanagers/{tm_id}/metrics")
async def taskmanager_metrics(
    flink_name: str, tm_id: str, ctx: ClusterContext = Depends(get_cluster), get: str | None = Query(None)
) -> Any:
    return await get_flink(ctx, flink_name).taskmanager_metrics(tm_id, get)


@router.get(FC + "/taskmanagers/{tm_id}/thread-dump")
async def taskmanager_thread_dump(
    flink_name: str, tm_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).taskmanager_thread_dump(tm_id)


@router.get(FC + "/jobmanager/logs")
async def jobmanager_logs(
    flink_name: str, ctx: ClusterContext = Depends(get_cluster), file: str | None = Query(None)
) -> Any:
    client = get_flink(ctx, flink_name)
    if file:
        return PlainTextResponse(await client.jobmanager_log(file))
    return await client.jobmanager_logs()


@router.get(FC + "/jobmanager/metrics")
async def jobmanager_metrics(
    flink_name: str, ctx: ClusterContext = Depends(get_cluster), get: str | None = Query(None)
) -> Any:
    return await get_flink(ctx, flink_name).jobmanager_metrics(get)


@router.get(FC + "/jobmanager/config")
async def jobmanager_config(
    flink_name: str, ctx: ClusterContext = Depends(get_cluster)
) -> list[dict[str, Any]]:
    return await get_flink(ctx, flink_name).jobmanager_config()


@router.get(FC + "/jars")
async def jars(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).jars()


@router.post(FC + "/jars/upload", dependencies=[Depends(require_editor)])
async def upload_jar(
    request: Request,
    flink_name: str,
    ctx: ClusterContext = Depends(get_cluster),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    content = await file.read()
    result = await get_flink(ctx, flink_name).upload_jar(file.filename or "job.jar", content)
    await audit(request, "flink.jar.upload", f"flink/{flink_name}", {"filename": file.filename})
    return result


@router.post(FC + "/jars/{jar_id}/run", dependencies=[Depends(require_editor)])
async def run_jar(
    request: Request,
    flink_name: str,
    jar_id: str,
    body: RunJarRequest,
    ctx: ClusterContext = Depends(get_cluster),
) -> dict[str, Any]:
    result = await get_flink(ctx, flink_name).run_jar(
        jar_id,
        {
            "entry-class": body.entryClass,
            "programArg": body.programArgs,
            "parallelism": body.parallelism,
            "savepointPath": body.savepointPath,
            "allowNonRestoredState": body.allowNonRestoredState,
        },
    )
    await audit(request, "flink.jar.run", f"flink/{flink_name}/{jar_id}", {"entryClass": body.entryClass})
    return result


@router.delete(FC + "/jars/{jar_id}", status_code=204, dependencies=[Depends(require_editor)])
async def delete_jar(
    request: Request, flink_name: str, jar_id: str, ctx: ClusterContext = Depends(get_cluster)
) -> None:
    await get_flink(ctx, flink_name).delete_jar(jar_id)
    await audit(request, "flink.jar.delete", f"flink/{flink_name}/{jar_id}", {})


@router.get(FC + "/sql")
async def sql_info(flink_name: str, ctx: ClusterContext = Depends(get_cluster)) -> dict[str, Any]:
    return await get_flink(ctx, flink_name).sql_info()


@router.post(FC + "/sql/sessions")
@non_mutating
async def sql_session(
    flink_name: str,
    ctx: ClusterContext = Depends(get_cluster),
    body: SqlSessionRequest = SqlSessionRequest(),
) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    if client.sql_gateway_url is None:
        return {"supported": False, "reason": "sqlGatewayUrl not configured"}
    return await client.sql_session(body.properties)


@router.post(FC + "/sql/sessions/{session}/statements")
@non_mutating
async def sql_statement(
    request: Request,
    flink_name: str,
    session: str,
    body: SqlStatementRequest,
    ctx: ClusterContext = Depends(get_cluster),
    settings: Settings = Depends(get_settings),
    principal: Principal = Depends(require_viewer),
) -> dict[str, Any]:
    """Run a statement. Read-only SQL (SELECT/SHOW/DESCRIBE/EXPLAIN/...) is open to viewers and
    read-only clusters; anything else needs the editor role and a writable cluster."""
    if not is_read_only_sql(body.statement, FLINK_READ_ONLY):
        enforce_mutation(request, settings, principal, "editor")
    client = get_flink(ctx, flink_name)
    if client.sql_gateway_url is None:
        return {"supported": False, "reason": "sqlGatewayUrl not configured"}
    await audit(request, "flink.sql", f"flink/{flink_name}", {"statement": body.statement})
    return await client.sql_statement(session, body.statement, body.properties)


@router.get(FC + "/sql/sessions/{session}/operations/{operation}/result")
async def sql_result(
    flink_name: str,
    session: str,
    operation: str,
    ctx: ClusterContext = Depends(get_cluster),
    token: int = Query(0, ge=0),
) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    if client.sql_gateway_url is None:
        return {"supported": False, "reason": "sqlGatewayUrl not configured"}
    return await client.sql_result(session, operation, token)


@router.delete(FC + "/sql/sessions/{session}/operations/{operation}", dependencies=[Depends(require_editor)])
async def sql_cancel_operation(
    flink_name: str, session: str, operation: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    if client.sql_gateway_url is None:
        return {"supported": False, "reason": "sqlGatewayUrl not configured"}
    return await client.sql_cancel_operation(session, operation)


@router.delete(FC + "/sql/sessions/{session}", dependencies=[Depends(require_editor)])
async def sql_close_session(
    flink_name: str, session: str, ctx: ClusterContext = Depends(get_cluster)
) -> dict[str, Any]:
    client = get_flink(ctx, flink_name)
    if client.sql_gateway_url is None:
        return {"supported": False, "reason": "sqlGatewayUrl not configured"}
    return await client.sql_close_session(session)
