"""Cluster-level dynamic configs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from k_shui.api.schemas.common import ConfigEntry, ConfigUpdate
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_admin, require_viewer
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/configs", tags=["cluster-configs"])


@router.get("", response_model=list[ConfigEntry])
async def get_cluster_configs(
    ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> list[ConfigEntry]:
    return [ConfigEntry(**e) for e in await KafkaAdmin.get(ctx).describe_configs("cluster")]


@router.put("", response_model=list[ConfigEntry])
async def update_cluster_configs(
    body: ConfigUpdate,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_admin),
) -> list[ConfigEntry]:
    entries = await KafkaAdmin.get(ctx).alter_configs("cluster", None, body.configs)
    await audit(
        request, "cluster.configs.update", resource=ctx.config.id, details={"keys": list(body.configs)}
    )
    publish("cluster.config.updated", ctx.config.id, {"keys": list(body.configs)})
    return [ConfigEntry(**e) for e in entries]
