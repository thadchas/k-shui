"""Topic and message response models."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from k_shui.api.schemas.common import ConfigEntry, Model


class TopicSchemaFlags(Model):
    key: bool = False
    value: bool = False


class TopicSummary(Model):
    name: str
    partitions: int = 0
    replicationFactor: int = 0
    isInternal: bool = False
    underReplicatedPartitions: int = 0
    offlinePartitions: int = 0
    sizeBytes: int = 0
    messageCount: int = 0
    cleanupPolicy: str | None = None
    retentionMs: int | None = None
    hasSchema: TopicSchemaFlags = TopicSchemaFlags()
    bytesInPerSec: float = 0.0
    bytesOutPerSec: float = 0.0


class PartitionDetail(Model):
    id: int
    leader: int | None = None
    replicas: list[int] = []
    isr: list[int] = []
    beginOffset: int = 0
    endOffset: int = 0
    sizeBytes: int = 0
    underReplicated: bool = False
    offline: bool = False


class TopicDetail(TopicSummary):
    partitionsDetail: list[PartitionDetail] = []
    configs: list[ConfigEntry] = []


class CreateTopicRequest(Model):
    name: str
    partitions: int = 1
    replicationFactor: int = -1
    configs: dict[str, Any] = Field(default_factory=dict)


class CloneTopicRequest(Model):
    name: str
    partitions: int | None = None
    replicationFactor: int | None = None


class AddPartitionsRequest(Model):
    count: int


class PurgePartition(Model):
    id: int
    beforeOffset: int = -1


class PurgeRequest(Model):
    partitions: list[PurgePartition] | None = None


class Message(Model):
    partition: int
    offset: int
    timestamp: int | None = None
    timestampType: str = "createTime"
    key: Any = None
    keyFormat: str = "string"
    value: Any = None
    valueFormat: str = "json"
    headers: dict[str, Any] = {}
    keySchemaId: int | None = None
    valueSchemaId: int | None = None
    sizeBytes: int = 0
    keyRaw: str | None = None
    valueRaw: str | None = None


class MessagesResponse(Model):
    items: list[Message] = []
    scanned: int = 0
    matched: int = 0
    truncated: bool = False
    assignments: list[dict[str, Any]] = []


class ProduceRequest(Model):
    partition: int | None = None
    key: Any = None
    value: Any = None
    headers: dict[str, Any] = Field(default_factory=dict)
    keyFormat: str = "string"
    valueFormat: str = "json"
    keySchemaSubject: str | None = None
    valueSchemaSubject: str | None = None


class ProduceResponse(Model):
    partition: int
    offset: int
    timestamp: int | None = None


class TopicSchemaRef(Model):
    subject: str
    version: int | None = None
    schemaId: int | None = None
    type: str | None = None


class TopicSchemaResponse(Model):
    key: TopicSchemaRef | None = None
    value: TopicSchemaRef | None = None
    strategy: str = "topic"


__all__ = [
    "AddPartitionsRequest",
    "CloneTopicRequest",
    "CreateTopicRequest",
    "Message",
    "MessagesResponse",
    "PartitionDetail",
    "ProduceRequest",
    "ProduceResponse",
    "PurgeRequest",
    "TopicDetail",
    "TopicSchemaRef",
    "TopicSchemaResponse",
    "TopicSummary",
]
