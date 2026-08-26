"""Partition remediation: leader elections, reassignment plans and (when supported) reassignment."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from k_shui.api.schemas.partitions import (
    ClearThrottleRequest,
    ClearThrottleResponse,
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
from k_shui.core.auth import Principal, non_mutating, require_editor, require_viewer
from k_shui.core.errors import Forbidden
from k_shui.core.events import publish
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.kafka.admin import KafkaAdmin
from k_shui.kafka.partitions import PartitionOps

router = APIRouter(prefix="/clusters/{cluster_id}/partitions", tags=["partitions"])

AUDIT_RESOURCE_LIMIT = 20


def _ops(ctx: ClusterContext) -> PartitionOps:
    return PartitionOps(KafkaAdmin.get(ctx))


def _audit_resource(refs: list[str]) -> str:
    """Audit ``resource`` stays short: the first few partitions plus a count (full list in details)."""
    if len(refs) <= AUDIT_RESOURCE_LIMIT:
        return ",".join(refs)
    return ",".join(refs[:AUDIT_RESOURCE_LIMIT]) + f" (+{len(refs) - AUDIT_RESOURCE_LIMIT} more)"


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
    """Preferred (or unclean) leader election; an empty ``partitions`` list targets the whole cluster.

    Unclean elections can lose committed data, so they need the admin role.
    """
    if body.electionType == "unclean" and not principal.is_admin:
        raise Forbidden(f"role 'admin' required for unclean elections (you are '{principal.role}')")
    targets = [(p.topic, p.partition) for p in body.partitions]
    result = await _ops(ctx).elect_leaders(targets, body.electionType)
    refs = [f"{t}-{p}" for t, p in targets]
    await audit(
        request,
        "partitions.elect_leaders",
        resource=_audit_resource(refs) or "*",
        details={
            "electionType": body.electionType,
            "partitions": len(targets) or "all",
            "partitionList": refs,
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
    """Reassignments currently in flight (replicas being added / removed) plus whether a
    replication throttle is still configured on any broker."""
    return ReassignmentsResponse(**await _ops(ctx).list_reassignments())


@router.post("/reassign/plan", response_model=ReassignPlanResponse)
@non_mutating
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
    """Move replicas. Returns 501 (with the CLI-equivalent JSON) when the client lacks the API.

    ``throttleBytesPerSec`` is applied only after the controller accepted the reassignment and
    is *not* removed automatically: call ``DELETE /partitions/throttle`` (or run
    ``kafka-reassign-partitions.sh --verify``) once ``GET /reassignments`` is empty.
    """
    partitions = [p.model_dump() for p in body.partitions]
    result = await _ops(ctx).reassign(partitions, body.throttleBytesPerSec)
    refs = [f"{p['topic']}-{p['partition']}" for p in partitions]
    await audit(
        request,
        "partitions.reassign",
        resource=_audit_resource(refs),
        details={
            "partitions": len(partitions),
            "partitionList": refs,
            "throttleBytesPerSec": body.throttleBytesPerSec,
            "failed": sum(1 for i in result["items"] if i["error"]),
        },
    )
    publish("partitions.reassigned", ctx.config.id, {"partitions": len(partitions)})
    return ReassignResponse(**result)


@router.delete("/throttle", response_model=ClearThrottleResponse)
async def clear_throttle(
    request: Request,
    body: ClearThrottleRequest | None = None,
    ctx: ClusterContext = Depends(get_cluster),
    principal: Principal = Depends(require_editor),
) -> ClearThrottleResponse:
    """Remove replication throttles left behind by a reassignment: the broker rate limits and
    the throttled-replica lists of ``topics`` (every topic carrying them when omitted)."""
    result = await _ops(ctx).clear_throttle(body.topics if body else None)
    await audit(
        request,
        "partitions.clear_throttle",
        resource=",".join(result["topics"]) or "*",
        details={"brokers": result["brokers"], "topics": result["topics"]},
    )
    publish("partitions.throttle_cleared", ctx.config.id, {"topics": len(result["topics"])})
    return ClearThrottleResponse(**result)
