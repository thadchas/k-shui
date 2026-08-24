"""Alerting request/response models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")

Component = Literal[
    "cluster",
    "broker",
    "topic",
    "consumerGroup",
    "connector",
    "ksqlQuery",
    "flinkJob",
    "schemaRegistry",
    "custom",
]
Condition = Literal["gt", "gte", "lt", "lte", "eq", "ne"]
Severity = Literal["critical", "warning", "info"]
ActionType = Literal["email", "slack", "pagerduty", "webhook", "teams"]


class TriggerTarget(BaseModel):
    model_config = LOOSE

    name: str | None = None
    regex: str | None = None
    expr: str | None = None


class Trigger(BaseModel):
    model_config = LOOSE

    id: str
    name: str
    clusterId: str | None = None
    component: str = "cluster"
    target: dict[str, Any] = {}
    metric: str
    condition: str = "gt"
    value: float = 0
    bufferSeconds: int = 0
    severity: str = "warning"
    enabled: bool = True
    actionIds: list[str] = []
    config: dict[str, Any] = {}
    createdAt: Any | None = None
    updatedAt: Any | None = None


class TriggerWrite(BaseModel):
    model_config = LOOSE

    name: str
    clusterId: str | None = None
    component: Component = "cluster"
    target: TriggerTarget = TriggerTarget()
    metric: str
    condition: Condition = "gt"
    value: float = 0
    bufferSeconds: int = 0
    severity: Severity = "warning"
    enabled: bool = True
    actionIds: list[str] = []
    config: dict[str, Any] = {}


class TriggerPatch(BaseModel):
    model_config = LOOSE

    name: str | None = None
    clusterId: str | None = None
    component: Component | None = None
    target: TriggerTarget | None = None
    metric: str | None = None
    condition: Condition | None = None
    value: float | None = None
    bufferSeconds: int | None = None
    severity: Severity | None = None
    enabled: bool | None = None
    actionIds: list[str] | None = None
    config: dict[str, Any] | None = None


class Action(BaseModel):
    model_config = LOOSE

    id: str
    name: str
    type: str
    config: dict[str, Any] = {}
    enabled: bool = True
    createdAt: Any | None = None
    updatedAt: Any | None = None


class ActionWrite(BaseModel):
    model_config = LOOSE

    name: str
    type: ActionType
    config: dict[str, Any] = {}
    enabled: bool = True


class ActionPatch(BaseModel):
    model_config = LOOSE

    name: str | None = None
    type: ActionType | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class HistoryEntry(BaseModel):
    model_config = LOOSE

    id: str
    triggerId: str
    triggerName: str = ""
    component: str = "cluster"
    target: str | None = None
    clusterId: str | None = None
    severity: str = "warning"
    status: str = "firing"
    value: float | None = None
    threshold: float | None = None
    firedAt: Any | None = None
    resolvedAt: Any | None = None
    ackedAt: Any | None = None
    ackedBy: str | None = None
    notifications: list[dict[str, Any]] = []


class HistoryPage(BaseModel):
    model_config = LOOSE

    items: list[HistoryEntry] = []
    page: int = 1
    perPage: int = 50
    total: int = 0


class AlertSummary(BaseModel):
    model_config = LOOSE

    firing: int = 0
    unacknowledged: int = 0
    bySeverity: dict[str, int] = {}
    byCluster: dict[str, int] = {}
    triggers: int = 0
    enabledTriggers: int = 0


class MetricCatalogEntry(BaseModel):
    model_config = LOOSE

    component: str
    metrics: list[dict[str, Any]] = []


class TestActionResult(BaseModel):
    model_config = LOOSE

    actionId: str | None = None
    actionType: str | None = None
    status: str = "sent"
    error: str | None = None
