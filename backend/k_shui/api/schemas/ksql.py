"""ksqlDB response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")


class KsqlServer(BaseModel):
    model_config = LOOSE

    name: str
    url: str
    version: str | None = None
    serverStatus: str | None = None
    ksqlServiceId: str | None = None
    kafkaClusterId: str | None = None
    healthy: bool = False


class KsqlRequest(BaseModel):
    model_config = LOOSE

    sql: str
    properties: dict[str, Any] = {}


class KsqlSource(BaseModel):
    model_config = LOOSE

    name: str | None = None
    topic: str | None = None
    keyFormat: str | None = None
    valueFormat: str | None = None
    type: str | None = None
    windowed: bool = False


class KsqlQuery(BaseModel):
    model_config = LOOSE

    id: str | None = None
    queryString: str | None = None
    sinks: list[str] = []
    sinkKafkaTopics: list[str] = []
    state: str | None = None
    queryType: str | None = None


class KsqlHistoryEntry(BaseModel):
    model_config = LOOSE

    id: str
    sql: str
    server: str
    clusterId: str | None = None
    user: str | None = None
    ts: float
    kind: str = "statement"
    ok: bool = True
    error: str | None = None
