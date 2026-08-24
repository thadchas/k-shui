"""Client quotas (user / client-id / ip)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.schemas.common import Ack
from k_shui.api.schemas.security import QuotaEntry, QuotaResponse
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_admin, require_viewer
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/quotas", tags=["quotas"])


@router.get("", response_model=QuotaResponse)
async def list_quotas(
    entityType: str | None = Query(None),
    entityName: str | None = Query(None),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> QuotaResponse:
    result = await KafkaAdmin.get(ctx).describe_quotas(entityType, entityName)
    return QuotaResponse(
        supported=result.get("supported", False),
        items=[QuotaEntry(**i) for i in result.get("items", [])],
        reason=result.get("reason"),
    )


@router.put("", response_model=QuotaResponse)
async def upsert_quota(
    body: QuotaEntry,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> QuotaResponse:
    result = await KafkaAdmin.get(ctx).alter_quotas(body.entityType, body.entityName, body.quotas)
    await audit(request, "quota.update", resource=f"{body.entityType}/{body.entityName}", details=body.quotas)
    return QuotaResponse(supported=result.get("supported", False), items=[body], reason=result.get("reason"))


@router.delete("", response_model=Ack)
async def delete_quota(
    request: Request,
    entityType: str = Query("client-id"),
    entityName: str | None = Query(None),
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> Ack:
    keys = {"producer_byte_rate": None, "consumer_byte_rate": None, "request_percentage": None}
    result = await KafkaAdmin.get(ctx).alter_quotas(entityType, entityName, keys)
    await audit(request, "quota.delete", resource=f"{entityType}/{entityName}")
    return Ack(ok=bool(result.get("supported")), detail=result.get("reason"))
