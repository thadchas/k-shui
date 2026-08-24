"""Consumer group response models."""

from __future__ import annotations

from typing import Any, Literal

from k_shui.api.schemas.common import Model


class GroupSummary(Model):
    groupId: str
    groupType: str = "classic"
    state: str = "unknown"
    protocolType: str | None = None
    protocol: str | None = None
    coordinatorId: int | None = None
    memberCount: int = 0
    topicCount: int = 0
    partitionCount: int = 0
    totalLag: int = 0
    isSimple: bool = False


class GroupMember(Model):
    memberId: str
    clientId: str | None = None
    host: str | None = None
    groupInstanceId: str | None = None
    assignments: list[dict[str, Any]] = []


class GroupPartition(Model):
    topic: str
    partition: int
    currentOffset: int | None = None
    endOffset: int = 0
    beginOffset: int = 0
    lag: int = 0
    memberId: str | None = None
    clientId: str | None = None
    host: str | None = None


class GroupTopicSummary(Model):
    topic: str
    lag: int = 0
    partitions: int = 0


class GroupDetail(GroupSummary):
    members: list[GroupMember] = []
    partitions: list[GroupPartition] = []
    topicsSummary: list[GroupTopicSummary] = []


class ResetOffsetsRequest(Model):
    topic: str | None = None
    partitions: list[int] | None = None
    strategy: Literal["earliest", "latest", "offset", "timestamp", "shiftBy"] = "earliest"
    value: int | None = None
    dryRun: bool = False


class ResetOffsetResult(Model):
    topic: str
    partition: int
    oldOffset: int | None = None
    newOffset: int | None = None
    error: str | None = None


class TopicConsumer(Model):
    groupId: str
    state: str = "unknown"
    lag: int = 0
    members: int = 0


__all__ = [
    "GroupDetail",
    "GroupMember",
    "GroupPartition",
    "GroupSummary",
    "GroupTopicSummary",
    "ResetOffsetResult",
    "ResetOffsetsRequest",
    "TopicConsumer",
]
