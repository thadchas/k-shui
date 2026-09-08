"""Client input never supplies acting identity, secrets, tools, or provider URLs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResourceContext(AgentInput):
    type: Literal[
        "cluster",
        "topic",
        "group",
        "consumer-group",
        "consumer_group",
        "connector",
        "job",
        "schema",
        "alert",
        "partition",
        "lineage",
    ]
    name: str = Field(min_length=1, max_length=249)
    connectCluster: str | None = Field(default=None, max_length=249)
    flinkCluster: str | None = Field(default=None, max_length=249)
    namespace: str | None = Field(default=None, max_length=249)


class TimeWindow(AgentInput):
    start: datetime | None = None
    end: datetime | None = None

    @model_validator(mode="after")
    def chronological(self) -> TimeWindow:
        if self.start and self.end:
            try:
                if self.start > self.end:
                    raise ValueError("time window start must be before end")
            except TypeError as exc:
                raise ValueError("use consistent timezone offsets") from exc
        return self


class CreateInvestigation(AgentInput):
    clusterId: str = Field(min_length=1, max_length=120)
    connectionId: str = Field(min_length=1, max_length=80)
    mode: Literal["inspect", "operate"] = "inspect"
    resource: ResourceContext | None = None
    timeWindow: TimeWindow | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)


class AddMessage(AgentInput):
    content: str = Field(min_length=1, max_length=8000)
    requestId: str = Field(default_factory=lambda: uuid.uuid4().hex, min_length=1, max_length=100)


class PrepareOperation(AgentInput):
    action: str = Field(min_length=1, max_length=80)
    target: dict[str, Any]
    parameters: dict[str, Any] = Field(default_factory=dict)


class ExecuteOperation(AgentInput):
    confirmation: str | None = Field(default=None, max_length=300)
