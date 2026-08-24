"""ACL, quota, SCRAM, auth and audit response models."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from k_shui.api.schemas.common import Model


class Acl(Model):
    resourceType: str
    resourceName: str
    patternType: str = "literal"
    principal: str
    host: str = "*"
    operation: str
    permissionType: str = "allow"


class AclCreateRequest(Acl):
    pass


class QuotaEntry(Model):
    entityType: str = "client-id"
    entityName: str | None = None
    quotas: dict[str, float | None] = Field(default_factory=dict)


class QuotaResponse(Model):
    supported: bool = True
    items: list[QuotaEntry] = []
    reason: str | None = None


class ScramCredential(Model):
    mechanism: str
    iterations: int | None = None


class ScramUser(Model):
    username: str
    credentials: list[ScramCredential] = []
    error: str | None = None


class ScramUpsertRequest(Model):
    username: str
    password: str
    mechanism: str = "SCRAM_SHA_512"
    iterations: int = 4096


class LoginRequest(Model):
    username: str
    password: str


class UserInfo(Model):
    username: str
    role: str = "viewer"
    clusters: list[str] | None = None
    anonymous: bool = False


class LoginResponse(Model):
    token: str
    expiresAt: int
    user: UserInfo


class AuditEntry(Model):
    id: int
    ts: str
    user: str
    action: str
    resource: str
    clusterId: str | None = None
    details: dict[str, Any] = {}
    ip: str | None = None
    status: int | None = None


class SystemInfo(Model):
    version: str
    uptimeSeconds: float
    auth: dict[str, Any] = {}
    features: dict[str, Any] = {}
    clusters: list[dict[str, Any]] = []
    readOnly: bool = False
    basePath: str = "/"


__all__ = [
    "Acl",
    "AclCreateRequest",
    "AuditEntry",
    "LoginRequest",
    "LoginResponse",
    "QuotaEntry",
    "QuotaResponse",
    "ScramCredential",
    "ScramUpsertRequest",
    "ScramUser",
    "SystemInfo",
    "UserInfo",
]
