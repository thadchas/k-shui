"""Request/response models for partition remediation (elections, reassignment plans)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field

from k_shui.api.schemas.common import Model


class PartitionRef(Model):
    topic: str = Field(min_length=1)
    partition: int = Field(ge=0)


class ElectLeadersRequest(Model):
    # Empty list = every partition in the cluster.
    partitions: list[PartitionRef] = []
    electionType: Literal["preferred", "unclean"] = "preferred"


class ElectionResult(Model):
    topic: str
    partition: int
    # elected | notNeeded | failed
    status: str
    error: str | None = None


class ElectLeadersResponse(Model):
    electionType: str
    items: list[ElectionResult] = []
    succeeded: int = 0
    failed: int = 0
    notNeeded: int = 0


class PartitionAssignment(Model):
    topic: str = Field(min_length=1)
    partition: int = Field(ge=0)
    # Distinctness is checked by the admin layer (400) so the error carries the partition.
    replicas: list[Annotated[int, Field(ge=0)]] = Field(min_length=1)


class ReassignRequest(Model):
    partitions: list[PartitionAssignment] = Field(min_length=1)
    throttleBytesPerSec: int | None = Field(default=None, ge=1)


class ReassignResult(Model):
    topic: str
    partition: int
    replicas: list[int]
    error: str | None = None


class ReassignResponse(Model):
    items: list[ReassignResult] = []
    throttleBytesPerSec: int | None = None
    reassignmentJson: dict[str, Any] = {}


class ReassignPlanRequest(Model):
    topics: list[str] = []
    brokers: list[int] | None = None


class PlanItem(Model):
    topic: str
    partition: int
    current: list[int]
    proposed: list[int]
    changed: bool


class ReassignPlanResponse(Model):
    items: list[PlanItem] = []
    changed: int = 0
    brokers: list[int] = []
    rackAware: bool = False
    applySupported: bool = False
    reassignmentJson: dict[str, Any] = {}
    command: str = ""


class ReassignmentInProgress(Model):
    topic: str
    partition: int
    replicas: list[int] = []
    addingReplicas: list[int] = []
    removingReplicas: list[int] = []


class ReassignmentsResponse(Model):
    supported: bool = True
    reason: str | None = None
    items: list[ReassignmentInProgress] = []


class PartitionCapabilities(Model):
    clientVersion: str
    electLeaders: bool
    reassign: bool
    listReassignments: bool


__all__ = [
    "ElectLeadersRequest",
    "ElectLeadersResponse",
    "ElectionResult",
    "PartitionAssignment",
    "PartitionCapabilities",
    "PartitionRef",
    "PlanItem",
    "ReassignPlanRequest",
    "ReassignPlanResponse",
    "ReassignRequest",
    "ReassignResponse",
    "ReassignResult",
    "ReassignmentInProgress",
    "ReassignmentsResponse",
]
