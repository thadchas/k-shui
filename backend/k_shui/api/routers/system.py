"""System information."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request

from k_shui import __version__
from k_shui.api.schemas.security import SystemInfo
from k_shui.config import Settings
from k_shui.core.auth import Principal, require_viewer
from k_shui.core.registry import ClusterRegistry, get_registry, get_settings

router = APIRouter(tags=["system"])


@router.get("/info", response_model=SystemInfo)
async def info(
    request: Request,
    settings: Settings = Depends(get_settings),
    registry: ClusterRegistry = Depends(get_registry),
    principal: Principal = Depends(require_viewer),
) -> SystemInfo:
    started = getattr(request.app.state, "started_at", time.time())
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
