"""Kafka ACLs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.schemas.security import Acl, AclCreateRequest
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_admin, require_viewer
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/acls", tags=["acls"])


@router.get("", response_model=list[Acl])
async def list_acls(
    resourceType: str | None = Query(None),
    resourceName: str | None = Query(None),
    principalFilter: str | None = Query(None, alias="principal"),
    patternType: str | None = Query(None),
    operation: str | None = Query(None),
    permissionType: str | None = Query(None),
    ctx: ClusterContext = Depends(get_cluster),
    caller: Principal = Depends(require_viewer),
) -> list[Acl]:
    items = await KafkaAdmin.get(ctx).describe_acls(
        resourceType=resourceType,
        resourceName=resourceName,
        principal=principalFilter,
        patternType=patternType,
        operation=operation,
        permissionType=permissionType,
    )
    return [Acl(**a) for a in items]


@router.post("", response_model=list[Acl], status_code=201)
async def create_acl(
    body: AclCreateRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    caller: Principal = Depends(require_admin),
) -> list[Acl]:
    created = await KafkaAdmin.get(ctx).create_acls([body.model_dump()])
    await audit(
        request, "acl.create", resource=f"{body.resourceType}/{body.resourceName}", details=body.model_dump()
    )
    publish("acl.created", ctx.config.id, body.model_dump())
    return [Acl(**{k: v for k, v in a.items() if k in Acl.model_fields}) for a in created]


@router.delete("", response_model=list[Acl])
async def delete_acls(
    request: Request,
    resourceType: str | None = Query(None),
    resourceName: str | None = Query(None),
    principalFilter: str | None = Query(None, alias="principal"),
    patternType: str | None = Query(None),
    operation: str | None = Query(None),
    permissionType: str | None = Query(None),
    ctx: ClusterContext = Depends(get_cluster),
    caller: Principal = Depends(require_admin),
) -> list[Acl]:
    deleted = await KafkaAdmin.get(ctx).delete_acls(
        resourceType=resourceType,
        resourceName=resourceName,
        principal=principalFilter,
        patternType=patternType,
        operation=operation,
        permissionType=permissionType,
    )
    await audit(request, "acl.delete", resource=resourceName or "*", details={"count": len(deleted)})
    return [Acl(**a) for a in deleted]
