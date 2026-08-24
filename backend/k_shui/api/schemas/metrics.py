"""Metrics / dashboard response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

LOOSE = ConfigDict(extra="allow")


class MetricsStatus(BaseModel):
    model_config = LOOSE

    configured: bool = False
    url: str | None = None
    reachable: bool = False
    labels: dict[str, str] = {}
    buildInfo: dict[str, Any] = {}
    targets: list[dict[str, Any]] = []


class QueryResult(BaseModel):
    model_config = LOOSE

    query: str
    resultType: str | None = None
    result: list[dict[str, Any]] = []


class SeriesResult(BaseModel):
    model_config = LOOSE

    series: list[dict[str, Any]] = []


class CatalogEntry(BaseModel):
    model_config = LOOSE

    name: str
    type: str = "unknown"
    help: str = ""
    unit: str = ""


class DashboardSummary(BaseModel):
    model_config = LOOSE

    id: str
    title: str
    description: str = ""
    tags: list[str] = []
    builtin: bool = False
    panelCount: int = 0


class DashboardPanel(BaseModel):
    model_config = LOOSE

    id: str
    title: str
    type: str = "timeseries"
    unit: str = "short"
    queries: list[dict[str, Any]] = []
    thresholds: list[dict[str, Any]] = []


class DashboardRow(BaseModel):
    model_config = LOOSE

    title: str = ""
    panels: list[DashboardPanel] = []


class Dashboard(BaseModel):
    model_config = LOOSE

    id: str
    title: str
    description: str = ""
    tags: list[str] = []
    builtin: bool = False
    variables: list[dict[str, Any]] = []
    rows: list[DashboardRow] = []


class DashboardWrite(BaseModel):
    model_config = LOOSE

    id: str | None = None
    title: str
    description: str = ""
    tags: list[str] = []
    variables: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []


class DashboardData(BaseModel):
    model_config = LOOSE

    configured: bool = True
    id: str | None = None
    range: str | None = None
    step: str | None = None
    panels: dict[str, Any] = {}
