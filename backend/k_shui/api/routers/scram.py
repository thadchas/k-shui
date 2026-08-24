"""SCRAM user credentials."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.schemas.common import Ack
from k_shui.api.schemas.security import ScramUpsertRequest, ScramUser
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_admin, require_viewer
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/scram-users", tags=["scram"])


@router.get("", response_model=list[ScramUser])
async def list_scram_users(
    users: str | None = Query(None, description="comma separated usernames"),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> list[ScramUser]:
    wanted = [u.strip() for u in users.split(",") if u.strip()] if users else None
    return [ScramUser(**u) for u in await KafkaAdmin.get(ctx).describe_scram_users(wanted)]


@router.post("", response_model=Ack, status_code=201)
async def upsert_scram_user(
    body: ScramUpsertRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> Ack:
    await KafkaAdmin.get(ctx).upsert_scram_user(body.username, body.password, body.mechanism, body.iterations)
    await audit(request, "scram.upsert", resource=body.username, details={"mechanism": body.mechanism})
    publish("scram.updated", ctx.config.id, {"username": body.username})
    return Ack(detail=f"scram credentials for '{body.username}' updated")


@router.delete("", response_model=Ack)
async def delete_scram_user(
    request: Request,
    username: str = Query(...),
    mechanism: str = Query("SCRAM_SHA_512"),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> Ack:
    await KafkaAdmin.get(ctx).delete_scram_user(username, mechanism)
    await audit(request, "scram.delete", resource=username)
    return Ack(detail=f"scram credentials for '{username}' deleted")


# `require_viewer` is intentionally unused here: SCRAM data is admin-only.
_ = require_viewer
