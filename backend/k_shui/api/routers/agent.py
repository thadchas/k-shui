"""Authenticated K-Shui Agent API. Deployment-managed provider credentials never leave the server."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from k_shui.agent import operations, service  # noqa: F401 - register operation table before create_all
from k_shui.agent.providers import RECOVERY, ProviderError, connection_state, test_connection
from k_shui.agent.tools import TOOL_DEFINITIONS, check_authority
from k_shui.api.schemas.agent import AddMessage, CreateInvestigation, ExecuteOperation, PrepareOperation
from k_shui.core.auth import Principal, Unauthorized, get_principal, optional_principal
from k_shui.core.errors import Conflict, Forbidden, KShuiError
from k_shui.db import session as db_session
from k_shui.db.models import KVStore

router = APIRouter(prefix="/agent", tags=["agent"])


async def require_agent(request: Request, principal: Principal = Depends(get_principal)) -> Principal:
    if principal.anonymous or request.app.state.settings.auth.type == "none":
        raise Unauthorized("K-Shui Agent requires an authenticated human user")
    if not request.app.state.settings.agent.enabled:
        raise Forbidden("K-Shui Agent is disabled by the administrator")
    if not principal.can("viewer"):
        raise Forbidden("viewer role required")
    return principal


async def _visible_clusters(request: Request, principal: Principal) -> tuple[list[str], Principal]:
    visible = []
    fresh = principal
    for cluster in request.app.state.settings.clusters:
        try:
            fresh, _ = await check_authority(request, principal, cluster.id)
            visible.append(cluster.id)
        except KShuiError:
            continue
    return visible, fresh


def _fingerprint(connection: Any) -> str:
    # A hash detects changed deployment settings/credentials without persisting the credential.
    return hashlib.sha256(
        (connection.model_dump_json() + os.environ.get(connection.apiKeyEnv, "")).encode()
    ).hexdigest()


async def _connections(request: Request, clusters: list[str]) -> list[dict[str, Any]]:
    result = []
    for connection in request.app.state.settings.agent.connections:
        allowed = [
            c for c in clusters if connection.allowedClusters is None or c in connection.allowedClusters
        ]
        if not allowed:
            continue
        state = connection_state(connection)
        tested: dict[str, Any] = {}
        if db_session.is_ready():
            async with db_session.session_scope() as session:
                row = await session.get(KVStore, "agent:connection:" + connection.id)
                if row and row.value and row.value.get("fingerprint") == _fingerprint(connection):
                    tested = row.value
                    if state == "untested":
                        state = tested["state"]
        result.append(
            {
                "id": connection.id,
                "name": connection.name,
                "provider": connection.provider,
                "model": connection.model,
                "managed": True,
                "credentialConfigured": bool(os.environ.get(connection.apiKeyEnv)),
                "state": state,
                "recovery": RECOVERY.get(state),
                "allowedClusters": allowed,
                "allowedTools": [
                    tool["function"]["name"]
                    for tool in TOOL_DEFINITIONS
                    if (
                        request.app.state.settings.agent.allowedTools is None
                        or tool["function"]["name"] in request.app.state.settings.agent.allowedTools
                    )
                    and (
                        connection.allowedTools is None or tool["function"]["name"] in connection.allowedTools
                    )
                ],
                "toolCapable": tested.get("toolCapable", False),
                "testedAt": tested.get("testedAt"),
                "pricingConfigured": connection.inputUsdPerMillion is not None
                and connection.outputUsdPerMillion is not None,
            }
        )
    return result


@router.get("/status")
async def status(
    request: Request, principal: Principal | None = Depends(optional_principal)
) -> dict[str, Any]:
    settings = request.app.state.settings
    policy = settings.agent
    enabled = (
        policy.enabled and principal is not None and not principal.anonymous and settings.auth.type != "none"
    )
    modes: list[str] = []
    clusters: list[str] = []
    if enabled and principal:
        clusters, principal = await _visible_clusters(request, principal)
        modes = ["inspect"] if clusters else []
        if (
            policy.allowMutations
            and principal.can("editor")
            and not settings.server.readOnly
            and any(not settings.cluster(c).readOnly for c in clusters)
        ):
            modes.append("operate")
    return {
        "enabled": enabled,
        "actingUser": principal.username if principal else "",
        "reason": "authentication_required"
        if principal is None or principal.anonymous
        else (None if policy.enabled else "disabled_by_administrator"),
        "effectiveModes": modes,
        "policy": {
            "allowPayloads": False,
            "maxToolCalls": policy.maxToolCalls,
            "maxRunSeconds": policy.maxRunSeconds,
            "maxInputChars": policy.maxInputChars,
            "maxOutputTokens": policy.maxOutputTokens,
            "maxRunCostUsd": policy.maxRunCostUsd,
        },
        "connections": await _connections(request, clusters) if enabled else [],
        "unsupportedConnections": ["Codex runtime", "Claude Code subscription", "custom endpoints", "MCP"],
    }


@router.get("/connections")
async def connections(
    request: Request, principal: Principal = Depends(require_agent)
) -> list[dict[str, Any]]:
    clusters, _ = await _visible_clusters(request, principal)
    return await _connections(request, clusters)


@router.post("/connections/{connection_id}/test")
async def connection_test(
    connection_id: str, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    clusters, fresh = await _visible_clusters(request, principal)
    if not fresh.is_admin or not clusters:
        raise Forbidden("connection tests require an administrator with permitted cluster access")
    connection = service.connection_for(request.app.state.settings, connection_id)
    if not any(connection.allowedClusters is None or c in connection.allowedClusters for c in clusters):
        raise Forbidden("connection is outside your allowed cluster scope")
    if not hasattr(request.app.state, "agent_test_times"):
        request.app.state.agent_test_times = {}
    key = connection.id
    stamp = time.monotonic()
    if stamp - request.app.state.agent_test_times.get(key, -60) < 30:
        raise Conflict("connection test cooldown is 30 seconds; wait before retrying")
    request.app.state.agent_test_times[key] = stamp
    try:
        result = await test_connection(connection, request.app.state.settings.agent.maxRunCostUsd)
    except ProviderError as exc:
        result = {**exc.to_dict(), "toolCapable": False}
    result["testedAt"] = service.now()
    async with db_session.session_scope() as session:
        row = await session.get(KVStore, "agent:connection:" + connection.id)
        value = {**result, "fingerprint": _fingerprint(connection)}
        if row:
            row.value = value
        else:
            session.add(KVStore(key="agent:connection:" + connection.id, value=value))
    return result


@router.get("/investigations")
async def investigations(
    request: Request, principal: Principal = Depends(require_agent)
) -> list[dict[str, Any]]:
    return await service.list_investigations(request, principal)


@router.post("/investigations", status_code=201)
async def create(
    body: CreateInvestigation, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    return await service.create_investigation(request, principal, body.model_dump(mode="json"))


@router.get("/investigations/{investigation_id}")
async def investigation(
    investigation_id: str, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    return await service.detail(request, principal, investigation_id)


@router.post("/investigations/{investigation_id}/messages", status_code=202)
async def message(
    investigation_id: str, body: AddMessage, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    return await service.add_message(request, principal, investigation_id, body.content, body.requestId)


@router.post("/investigations/{investigation_id}/cancel")
async def cancel(
    investigation_id: str, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    return await service.cancel(request, principal, investigation_id)


@router.post("/investigations/{investigation_id}/evidence/{evidence_id}/refresh")
async def refresh_evidence(
    investigation_id: str,
    evidence_id: str,
    request: Request,
    principal: Principal = Depends(require_agent),
) -> dict[str, Any]:
    return await service.refresh_evidence(request, principal, investigation_id, evidence_id)


@router.get("/investigations/{investigation_id}/events")
async def events(
    investigation_id: str, request: Request, principal: Principal = Depends(require_agent)
) -> EventSourceResponse:
    await service.get_owned(request, principal, investigation_id)

    async def stream():
        previous = ""
        while not await request.is_disconnected():
            try:
                snapshot = await service.detail(request, principal, investigation_id)
            except KShuiError:
                yield {"event": "stopped", "data": json.dumps({"reason": "access_changed"})}
                return
            encoded = json.dumps(snapshot)
            if encoded != previous:
                yield {"event": "investigation", "data": encoded}
                previous = encoded
            if snapshot["status"] != "running":
                return
            await asyncio.sleep(0.5)

    return EventSourceResponse(stream())


async def _operate(request: Request, principal: Principal, investigation_id: str):
    row = await service.get_owned(request, principal, investigation_id)
    if row.status == "cancelled":
        raise Conflict("investigation is cancelled; start a new investigation for operations")
    if row.data.get("mode") != "operate":
        raise Forbidden("this investigation is in Inspect mode")
    await check_authority(request, principal, row.cluster_id, mutation=True)
    return row


@router.post("/investigations/{investigation_id}/operations/prepare")
async def prepare(
    investigation_id: str,
    body: PrepareOperation,
    request: Request,
    principal: Principal = Depends(require_agent),
) -> dict[str, Any]:
    from k_shui.agent.operations import prepare_operation

    row = await _operate(request, principal, investigation_id)
    return await prepare_operation(
        request, principal, investigation_id, row.cluster_id, body.action, body.target, body.parameters
    )


@router.post("/investigations/{investigation_id}/operations/{operation_id}/execute")
async def execute(
    investigation_id: str,
    operation_id: str,
    body: ExecuteOperation,
    request: Request,
    principal: Principal = Depends(require_agent),
) -> dict[str, Any]:
    from k_shui.agent.operations import execute_operation

    row = await _operate(request, principal, investigation_id)
    return await execute_operation(
        request, principal, investigation_id, row.cluster_id, operation_id, body.confirmation
    )


@router.post("/investigations/{investigation_id}/operations/{operation_id}/cancel")
async def cancel_operation(
    investigation_id: str, operation_id: str, request: Request, principal: Principal = Depends(require_agent)
) -> dict[str, Any]:
    from k_shui.agent.operations import cancel_operation as cancel_prepared

    row = await service.get_owned(request, principal, investigation_id)
    return await cancel_prepared(request, principal, investigation_id, row.cluster_id, operation_id)
