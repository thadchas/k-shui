"""Flink response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")


class FlinkCluster(BaseModel):
    model_config = LOOSE

    name: str
    url: str
    version: str | None = None
    status: str = "offline"
    sqlGateway: bool = False
    taskmanagers: int = 0
    slotsTotal: int = 0
    slotsAvailable: int = 0
    jobsRunning: int = 0
    jobsFinished: int = 0
    jobsCancelled: int = 0
    jobsFailed: int = 0


class FlinkJob(BaseModel):
    model_config = LOOSE

    jid: str
    name: str | None = None
    state: str | None = None
    startTime: int | None = None
    endTime: int | None = None
    duration: int | None = None
    tasks: dict[str, Any] = {}


class SavepointRequest(BaseModel):
    model_config = LOOSE

    targetDirectory: str | None = None
    cancelJob: bool = False
    drain: bool = False


class RunJarRequest(BaseModel):
    model_config = LOOSE

    entryClass: str | None = None
    programArgs: str | None = None
    parallelism: int | None = None
    savepointPath: str | None = None
    allowNonRestoredState: bool | None = None


class SqlSessionRequest(BaseModel):
    model_config = LOOSE

    properties: dict[str, Any] = {}


class SqlStatementRequest(BaseModel):
    model_config = LOOSE

    statement: str
    properties: dict[str, Any] = {}
