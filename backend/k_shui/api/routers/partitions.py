"""Partition remediation: leader elections, reassignment plans and (when supported) reassignment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from k_shui.api.schemas.partitions import (
    ElectLeadersRequest,
    ElectLeadersResponse,
    PartitionCapabilities,
    ReassignmentsResponse,
    ReassignPlanRequest,
    ReassignPlanResponse,
    ReassignRequest,
    ReassignResponse,
)
from k_shui.core.audit import audit
from k_shui.core.auth import Principal, require_editor, require_viewer
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin
from k_shui.kafka.partitions import PartitionOps

router = APIRouter(prefix="/clusters/{cluster_id}/partitions", tags=["partitions"])


def _ops(ctx: ClusterContext) -> PartitionOps:
    return PartitionOps(KafkaAdmin.get(ctx))


@router.get("/capabilities", response_model=PartitionCapabilities)
async def partition_capabilities(
    ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> PartitionCapabilities:
    """Which remediation APIs the installed Kafka client can drive (the UI degrades on ``false``)."""
    return PartitionCapabilities(**_ops(ctx).capabilities())


@router.post("/elect-leaders", response_model=ElectLeadersResponse)
async def elect_leaders(
    body: ElectLeadersRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> ElectLeadersResponse:
    """Preferred (or unclean) leader election; an empty ``partitions`` list targets the whole cluster."""
    targets = [(p.topic, p.partition) for p in body.partitions]
    result = await _ops(ctx).elect_leaders(targets, body.electionType)
    await audit(
        request,
        "partitions.elect_leaders",
        resource=",".join(f"{t}-{p}" for t, p in targets) or "*",
        details={
            "electionType": body.electionType,
            "partitions": len(targets) or "all",
            "succeeded": result["succeeded"],
            "failed": result["failed"],
        },
    )
    publish("partitions.leaders_elected", ctx.config.id, {"electionType": body.electionType})
    return ElectLeadersResponse(**result)


@router.get("/reassignments", response_model=ReassignmentsResponse)
async def list_reassignments(
    ctx: ClusterContext = Depends(get_cluster), principal: Principal = Depends(require_viewer)
) -> ReassignmentsResponse:
    """Reassignments currently in flight (replicas being added / removed)."""
    return ReassignmentsResponse(**await _ops(ctx).list_reassignments())


@router.post("/reassign/plan", response_model=ReassignPlanResponse)
async def reassign_plan(
    body: ReassignPlanRequest,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_viewer),
) -> ReassignPlanResponse:
    """Propose a balanced, rack-aware assignment for ``topics`` (all topics when empty). Never applies."""
    return ReassignPlanResponse(**await _ops(ctx).plan(body.topics, body.brokers))


@router.post("/reassign", response_model=ReassignResponse)
async def reassign(
    body: ReassignRequest,
    request: Request,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> ReassignResponse:
    """Move replicas. Returns 501 (with the CLI-equivalent JSON) when the client lacks the API."""
    partitions = [p.model_dump() for p in body.partitions]
    result = await _ops(ctx).reassign(partitions, body.throttleBytesPerSec)
    await audit(
        request,
        "partitions.reassign",
        resource=",".join(f"{p['topic']}-{p['partition']}" for p in partitions),
        details={
            "partitions": len(partitions),
            "throttleBytesPerSec": body.throttleBytesPerSec,
            "failed": sum(1 for i in result["items"] if i["error"]),
        },
    )
    publish("partitions.reassigned", ctx.config.id, {"partitions": len(partitions)})
    return ReassignResponse(**result)
