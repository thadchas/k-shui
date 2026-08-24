"""Audit trail: middleware for every mutating request plus an explicit ``audit()`` helper."""

from __future__ import annotations

import re
from typing import Any

from fastapi import Request
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from starlette.types import ASGIApp

from k_shui.core.logging import get_logger
from k_shui.db import session as db_session
from k_shui.db.models import AuditLog

log = get_logger(__name__)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PATHS = re.compile(r"^/(healthz|readyz|metrics)$|/auth/(login|logout)$")


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def current_user(request: Request) -> str:
    principal = getattr(request.state, "principal", None)
    if principal is not None:
        return getattr(principal, "username", "anonymous")
    return "anonymous"


async def write_audit(
    *,
    user: str,
    action: str,
    resource: str = "",
    cluster_id: str | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
    status: int | None = None,
) -> None:
    if not db_session.is_ready():
        log.debug("audit.skipped_no_db", action=action, resource=resource)
        return
    try:
        async with db_session.session_scope() as session:
            session.add(
                AuditLog(
                    user=user,
                    action=action,
                    resource=resource,
                    cluster_id=cluster_id,
                    details=details,
                    ip=ip,
                    status=status,
                )
            )
    except Exception as exc:  # never fail a request because of auditing
        log.warning("audit.write_failed", error=str(exc), action=action)


async def audit(
    request: Request,
    action: str,
    resource: str = "",
    details: dict[str, Any] | None = None,
    cluster_id: str | None = None,
) -> None:
    """Record an explicit audit entry; suppresses the generic middleware entry."""
    request.state.audited = True
    await write_audit(
        user=current_user(request),
        action=action,
        resource=resource,
        cluster_id=cluster_id or request.path_params.get("cluster_id"),
        details=details,
        ip=client_ip(request),
        status=None,
    )


async def list_audit(
    page: int = 1,
    per_page: int = 50,
    cluster_id: str | None = None,
    user: str | None = None,
    action: str | None = None,
) -> dict[str, Any]:
    from sqlalchemy import func as safunc

    if not db_session.is_ready():
        return {"items": [], "page": page, "perPage": per_page, "total": 0}
    stmt = select(AuditLog)
    if cluster_id:
        stmt = stmt.where(AuditLog.cluster_id == cluster_id)
    if user:
        stmt = stmt.where(AuditLog.user == user)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"%{action}%"))
    async with db_session.session_scope() as session:
        total = (await session.execute(select(safunc.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (
            (
                await session.execute(
                    stmt.order_by(AuditLog.id.desc()).offset((page - 1) * per_page).limit(per_page)
                )
            )
            .scalars()
            .all()
        )
        return {"items": [r.to_dict() for r in rows], "page": page, "perPage": per_page, "total": int(total)}


class AuditMiddleware(BaseHTTPMiddleware):
    """Records a generic audit row for mutating API calls not already audited explicitly."""

    def __init__(self, app: ASGIApp, prefix: str = "/api/v1") -> None:
        super().__init__(app)
        self.prefix = prefix

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        path = request.url.path
        if request.method not in MUTATING_METHODS or self.prefix not in path or SKIP_PATHS.search(path):
            return response
        if getattr(request.state, "audited", False):
            return response
        await write_audit(
            user=current_user(request),
            action=f"{request.method} {path}",
            resource=path,
            cluster_id=request.path_params.get("cluster_id"),
            details={"query": dict(request.query_params)} if request.query_params else None,
            ip=client_ip(request),
            status=response.status_code,
        )
        return response


__all__ = ["AuditMiddleware", "audit", "client_ip", "current_user", "list_audit", "write_audit"]
