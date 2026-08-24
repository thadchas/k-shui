"""Cluster, broker and KRaft response models."""

from __future__ import annotations

from typing import Any

from k_shui.api.schemas.common import Model


class ClusterFeatures(Model):
    schemaRegistry: bool = False
    connect: bool = False
    ksqldb: bool = False
    flink: bool = False
    prometheus: bool = False
    lineage: bool = False


class ClusterSummary(Model):
    id: str
    name: str
    status: str = "offline"  # online | degraded | offline
    version: str | None = None
    controllerId: int | None = None
    brokerCount: int = 0
    onlineBrokers: int = 0
    topicCount: int = 0
    partitionCount: int = 0
    underReplicatedPartitions: int = 0
    offlinePartitions: int = 0
    inSyncReplicasPct: float = 100.0
    bytesInPerSec: float = 0.0
    bytesOutPerSec: float = 0.0
    messagesInPerSec: float = 0.0
    features: ClusterFeatures = ClusterFeatures()
    error: str | None = None


class KraftQuorum(Model):
    supported: bool = True
    leaderId: int | None = None
    leaderEpoch: int | None = None
    highWatermark: int | None = None
    voters: list[dict[str, Any]] = []
    observers: list[dict[str, Any]] = []
    reason: str | None = None


class ClusterDetail(ClusterSummary):
    clusterId: str | None = None
    bootstrapServers: str = ""
    listeners: list[str] = []
    kraft: KraftQuorum | None = None
    metricsMode: str = "sampled"
    readOnly: bool = False


class Broker(Model):
    id: int
    host: str | None = None
    port: int | None = None
    rack: str | None = None
    isController: bool = False
    partitionCount: int = 0
    leaderCount: int = 0
    underReplicatedPartitions: int = 0
    logDirSizeBytes: int | None = None
    status: str = "online"
    version: str | None = None


class LogDirPartition(Model):
    topic: str | None = None
    partition: int | None = None
    sizeBytes: int | None = None
    offsetLag: int | None = None


class LogDir(Model):
    path: str
    sizeBytes: int | None = None
    partitions: list[LogDirPartition] = []


__all__ = [
    "Broker",
    "ClusterDetail",
    "ClusterFeatures",
    "ClusterSummary",
    "KraftQuorum",
    "LogDir",
    "LogDirPartition",
]
