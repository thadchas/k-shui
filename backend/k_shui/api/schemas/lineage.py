"""Stream lineage response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")


class LineageNode(BaseModel):
    model_config = LOOSE

    id: str
    type: str
    label: str
    namespace: str | None = None
    status: str | None = None
    clusterId: str | None = None
    sources: list[str] = []
    meta: dict[str, Any] = {}


class LineageEdge(BaseModel):
    model_config = LOOSE

    id: str
    source: str
    target: str
    kind: str = "produces"
    meta: dict[str, Any] = {}


class LineageGraph(BaseModel):
    model_config = LOOSE

    nodes: list[LineageNode] = []
    edges: list[LineageEdge] = []
    sources: list[str] = []
    clusterId: str | None = None
    focus: str | None = None


class LineageNodeDetail(BaseModel):
    model_config = LOOSE

    id: str
    type: str
    label: str
    namespace: str | None = None
    status: str | None = None
    meta: dict[str, Any] = {}
    upstream: list[str] = []
    downstream: list[str] = []
    latestRuns: list[dict[str, Any]] = []
    facets: dict[str, Any] = {}
    schemaFields: list[dict[str, Any]] = []


class OpenLineageResult(BaseModel):
    model_config = LOOSE

    accepted: bool = True
    forwarded: bool = False
    stored: int = 0
    status: int | None = None
