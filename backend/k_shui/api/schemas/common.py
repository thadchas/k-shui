"""Shared pydantic response models (camelCase, matching ARCHITECTURE.md)."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class Page(Model, Generic[T]):
    items: list[T] = []
    page: int = 1
    perPage: int = 50
    total: int = 0


class SeriesPoint(Model):
    pass


class Series(Model):
    name: str
    labels: dict[str, str] = {}
    points: list[list[float]] = []


class SeriesResponse(Model):
    series: list[Series] = []
    source: str = "sampled"


class HealthCheck(Model):
    name: str
    status: str  # ok | warn | error
    message: str | None = None


class HealthResponse(Model):
    status: str
    checks: list[HealthCheck] = []


class ConfigEntry(Model):
    name: str
    value: str | None = None
    source: str | None = None
    isDefault: bool = False
    isReadOnly: bool = False
    isSensitive: bool = False
    documentation: str | None = None
    synonyms: list[str] = []


class ConfigUpdate(Model):
    configs: dict[str, Any] = Field(default_factory=dict)


class Ack(Model):
    ok: bool = True
    detail: str | None = None


__all__ = [
    "Ack",
    "ConfigEntry",
    "ConfigUpdate",
    "HealthCheck",
    "HealthResponse",
    "Model",
    "Page",
    "Series",
    "SeriesResponse",
]
