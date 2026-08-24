"""Best-effort audit + event helpers for the integration routers.

``k_shui.core.audit`` / ``k_shui.core.events`` are owned by another module, so both are
imported lazily and every failure is swallowed: telemetry must never break a request or
prevent the app from starting.
"""

from __future__ import annotations

import contextlib
import inspect
from typing import Any

from fastapi import Request


async def audit(
    request: Request | None,
    action: str,
    resource: str = "",
    details: dict[str, Any] | None = None,
    cluster_id: str | None = None,
) -> None:
    """Record an explicit audit entry (also suppresses the generic middleware entry)."""
    try:
        from k_shui.core.audit import audit as _audit
        from k_shui.core.audit import write_audit
    except Exception:
        return
    with contextlib.suppress(Exception):
        if request is not None:
            await _audit(request, action, resource, details, cluster_id)
        else:
            await write_audit(
                user="system",
                action=action,
                resource=resource,
                cluster_id=cluster_id,
                details=details,
            )


async def publish(event_type: str, cluster_id: str | None, payload: dict[str, Any]) -> None:
    """Publish an SSE event (the core bus publish is synchronous; awaitables are awaited)."""
    try:
        from k_shui.core.events import publish as _publish
    except Exception:
        return
    with contextlib.suppress(Exception):
        result = _publish(event_type, cluster_id, payload)
        if inspect.isawaitable(result):
            await result
