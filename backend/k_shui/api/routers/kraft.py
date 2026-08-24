"""KRaft metadata quorum."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from k_shui.api.schemas.cluster import KraftQuorum
from k_shui.core.auth import Principal, require_viewer
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin

router = APIRouter(prefix="/clusters/{cluster_id}/kraft", tags=["kraft"])


@router.get("/quorum", response_model=KraftQuorum)
async def quorum(
    ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> KraftQuorum:
    return KraftQuorum(**await KafkaAdmin.get(ctx).kraft_quorum())
