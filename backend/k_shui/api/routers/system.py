"""System information."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request

from k_shui import __version__
from k_shui.api.schemas.security import SystemInfo
from k_shui.config import Settings
from k_shui.core.auth import Principal, optional_principal
from k_shui.core.registry import ClusterRegistry, get_registry, get_settings

router = APIRouter(tags=["system"])


@router.get("/info", response_model=SystemInfo)
async def info(
    request: Request,
    settings: Settings = Depends(get_settings),
    registry: ClusterRegistry = Depends(get_registry),
    principal: Principal | None = Depends(optional_principal),
) -> SystemInfo:
    """Bootstrap document for the UI.

    This is the one endpoint an unauthenticated client may read: it has to learn *how*
    to sign in before it can. Anonymous callers therefore get the auth block and nothing
    else — no cluster inventory, no feature flags.
    """
    started = getattr(request.app.state, "started_at", time.time())
    if principal is None:
        return SystemInfo(
            version=__version__,
            uptimeSeconds=round(time.time() - started, 3),
            auth={"type": settings.auth.type, "enabled": True, "user": None},
            features={},
            clusters=[],
            readOnly=settings.server.readOnly,
            basePath=settings.server.basePath,
        )
    features: dict[str, bool] = {}
    for ctx in registry.all():
        for key, enabled in ctx.config.features.items():
            features[key] = features.get(key, False) or enabled
    features["alerts"] = True
    features["audit"] = True
    features["metrics"] = settings.telemetry.metrics
    return SystemInfo(
        version=__version__,
        uptimeSeconds=round(time.time() - started, 3),
        auth={
            "type": settings.auth.type,
            "enabled": settings.auth.type != "none",
            "user": principal.to_dict(),
        },
        features=features,
        clusters=[{"id": c.config.id, "name": c.config.name or c.config.id} for c in registry.all()],
        readOnly=settings.server.readOnly,
        basePath=settings.server.basePath,
    )
