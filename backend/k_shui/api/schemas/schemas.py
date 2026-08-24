"""Schema Registry response models.

``schema`` and ``from`` are reserved-ish names in Python/pydantic, so the fields are
declared as ``schemaText``/``fromVersion`` with an alias — FastAPI serialises response
models ``by_alias=True``, so the wire format matches the contract exactly.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

ALIASED = ConfigDict(populate_by_name=True, extra="allow")


class SubjectSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    subject: str
    latestVersion: int | None = None
    schemaId: int | None = None
    schemaType: str = "AVRO"
    compatibility: str | None = None
    compatibilityInherited: bool = True
    versionsCount: int = 0
    topic: str | None = None


class SchemaVersion(BaseModel):
    model_config = ALIASED

    subject: str
    version: int | None = None
    id: int | None = None
    schemaType: str = "AVRO"
    schemaText: str = Field("", alias="schema")
    references: list[dict[str, Any]] = []
    createdAt: Any | None = None
    deleted: bool = False


class SubjectDetail(BaseModel):
    model_config = ConfigDict(extra="allow")

    subject: str
    compatibility: str
    versions: list[SchemaVersion] = []


class SchemaById(BaseModel):
    model_config = ALIASED

    id: int
    schemaText: str = Field("", alias="schema")
    schemaType: str = "AVRO"
    references: list[dict[str, Any]] = []
    subjects: list[dict[str, Any]] = []


class RegisterSchemaRequest(BaseModel):
    model_config = ALIASED

    schemaText: str | dict[str, Any] | list[Any] = Field("", alias="schema")
    schemaType: str = "AVRO"
    references: list[dict[str, Any]] = []
    normalize: bool = False

    def text(self) -> str:
        if isinstance(self.schemaText, dict | list):
            return json.dumps(self.schemaText)
        return str(self.schemaText or "")


class RegisterSchemaResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    subject: str
    version: int | None = None


class CompatibilityRequest(BaseModel):
    model_config = ALIASED

    schemaText: str | dict[str, Any] | list[Any] = Field("", alias="schema")
    schemaType: str = "AVRO"
    references: list[dict[str, Any]] = []
    version: str = "latest"

    def text(self) -> str:
        if isinstance(self.schemaText, dict | list):
            return json.dumps(self.schemaText)
        return str(self.schemaText or "")


class CompatibilityResult(BaseModel):
    isCompatible: bool
    messages: list[str] = []


class ConfigBody(BaseModel):
    compatibility: str


class ConfigResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    compatibility: str | None = None
    explicit: bool = False


class SchemaDiff(BaseModel):
    model_config = ALIASED

    subject: str
    fromVersion: int | str | None = Field(None, alias="from")
    to: int | str | None = None
    fromSchema: str = ""
    toSchema: str = ""
    identical: bool = False
    unifiedDiff: str = ""


class RegistryInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    url: str
    mode: str | None = None
    version: str | None = None
    serverType: str | None = None
    reachable: bool = False
    compatibility: str | None = None
