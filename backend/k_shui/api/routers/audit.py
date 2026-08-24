"""Audit log browsing."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from k_shui.api.schemas.common import Page
from k_shui.api.schemas.security import AuditEntry
from k_shui.core.audit import list_audit
from k_shui.core.auth import Principal, require_viewer
from k_shui.core.deps import Pagination, pagination

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=Page[AuditEntry])
async def get_audit(
    page: Pagination = Depends(pagination),
    clusterId: str | None = Query(None),
    user: str | None = Query(None),
    action: str | None = Query(None),
    principal: Principal = Depends(require_viewer),
) -> Page[AuditEntry]:
    result = await list_audit(page.page, page.per_page, clusterId, user, action)
    return Page[AuditEntry](**result)
