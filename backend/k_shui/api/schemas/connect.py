"""Kafka Connect response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")


class ConnectCluster(BaseModel):
    model_config = LOOSE

    name: str
    url: str
    version: str | None = None
    commit: str | None = None
    kafkaClusterId: str | None = None
    status: str = "offline"
    connectorCount: int = 0
    runningTasks: int = 0
    failedTasks: int = 0
    pausedTasks: int = 0
    failedConnectors: int = 0


class ConnectorTask(BaseModel):
    model_config = LOOSE

    id: int | None = None
    state: str | None = None
    workerId: str | None = None
    trace: str | None = None


class Connector(BaseModel):
    model_config = LOOSE

    name: str
    type: str = "source"
    connectorClass: str | None = None
    connectorClassShort: str | None = None
    state: str = "UNASSIGNED"
    workerId: str | None = None
    trace: str | None = None
    tasksMax: int | None = None
    taskCount: int = 0
    runningTasks: int = 0
    failedTasks: int = 0
    tasks: list[ConnectorTask] = []
    topics: list[str] = []
    config: dict[str, Any] = {}


class CreateConnectorRequest(BaseModel):
    name: str
    config: dict[str, Any] = {}


class ValidateRequest(BaseModel):
    model_config = LOOSE

    config: dict[str, Any] = {}


class PluginInfo(BaseModel):
    model_config = LOOSE

    class_: str | None = None
    type: str | None = None
    version: str | None = None


class OffsetsPatch(BaseModel):
    offsets: list[dict[str, Any]] = []


class ReplicationFlow(BaseModel):
    model_config = LOOSE

    id: str
    connectCluster: str
    connectorName: str
    kind: str
    connectorClass: str | None = None
    sourceAlias: str | None = None
    targetAlias: str | None = None
    sourceBootstrapServers: str | None = None
    targetBootstrapServers: str | None = None
    state: str = "UNASSIGNED"
    topicsPattern: str | None = None
    topics: list[str] = []
    groupsPattern: str | None = None
    tasks: int = 0
    failedTasks: int = 0
    replicationPolicy: str | None = None


class ReplicationSummary(BaseModel):
    model_config = LOOSE

    supported: bool = True
    detected: bool = False
    flows: list[ReplicationFlow] = []
    links: list[dict[str, Any]] = []
    connectClusters: list[str] = []
