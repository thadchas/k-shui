"""MirrorMaker2 / Confluent Replicator overview (`/clusters/{c}/replication`)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from k_shui.api.schemas.connect import ReplicationSummary
from k_shui.core.auth import require_viewer
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.integrations.replication import detect

router = APIRouter(tags=["replication"], dependencies=[Depends(require_viewer)])


@router.get("/clusters/{cluster_id}/replication", response_model=ReplicationSummary)
async def replication(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await detect(ctx)
