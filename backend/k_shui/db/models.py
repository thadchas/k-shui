"""SQLAlchemy 2 ORM models. Created with ``create_all`` at startup (no migrations yet)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _now() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), index=True
    )
    user: Mapped[str] = mapped_column(String(200), default="anonymous", index=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    resource: Mapped[str] = mapped_column(String(500), default="")
    cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ts": (self.ts or _now()).isoformat(),
            "user": self.user,
            "action": self.action,
            "resource": self.resource,
            "clusterId": self.cluster_id,
            "details": self.details or {},
            "ip": self.ip,
            "status": self.status,
        }


class User(Base):
    """Users materialised from config (basic auth) or created at runtime."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    source: Mapped[str] = mapped_column(String(20), default="config")  # config | db | oidc
    clusters: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "role": self.role,
            "source": self.source,
            "clusters": self.clusters,
            "createdAt": (self.created_at or _now()).isoformat(),
        }


class SavedQuery(Base):
    __tablename__ = "saved_queries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(40), default="ksql", index=True)  # ksql | promql | filter
    name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    body: Mapped[str] = mapped_column(Text, default="")
    target: Mapped[str | None] = mapped_column(String(200), nullable=True)  # e.g. ksql server name
    created_by: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "clusterId": self.cluster_id,
            "kind": self.kind,
            "name": self.name,
            "body": self.body,
            "target": self.target,
            "createdBy": self.created_by,
            "createdAt": (self.created_at or _now()).isoformat(),
        }


class KVStore(Base):
    """Generic key/value bag for small pieces of state."""

    __tablename__ = "kv_store"

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AlertTrigger(Base):
    __tablename__ = "alert_triggers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(300))
    cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    component: Mapped[str] = mapped_column(String(40), index=True)
    target: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)  # {name?, regex?}
    metric: Mapped[str] = mapped_column(String(200))
    condition: Mapped[str] = mapped_column(String(10), default="gt")
    value: Mapped[float] = mapped_column(Float, default=0.0)
    buffer_seconds: Mapped[int] = mapped_column(Integer, default=0)
    severity: Mapped[str] = mapped_column(String(20), default="warning")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    action_ids: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)  # extra (promql expr, …)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "clusterId": self.cluster_id,
            "component": self.component,
            "target": self.target or {},
            "metric": self.metric,
            "condition": self.condition,
            "value": self.value,
            "bufferSeconds": self.buffer_seconds,
            "severity": self.severity,
            "enabled": self.enabled,
            "actionIds": self.action_ids or [],
            "config": self.config or {},
            "createdAt": (self.created_at or _now()).isoformat(),
            "updatedAt": (self.updated_at or _now()).isoformat(),
        }


class AlertAction(Base):
    __tablename__ = "alert_actions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(300))
    type: Mapped[str] = mapped_column(String(40), index=True)  # email|slack|pagerduty|webhook|teams
    config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "config": self.config or {},
            "enabled": self.enabled,
            "createdAt": (self.created_at or _now()).isoformat(),
            "updatedAt": (self.updated_at or _now()).isoformat(),
        }


class AlertHistory(Base):
    __tablename__ = "alert_history"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    trigger_id: Mapped[str] = mapped_column(String(64), index=True)
    trigger_name: Mapped[str] = mapped_column(String(300), default="")
    component: Mapped[str] = mapped_column(String(40), index=True)
    target: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    severity: Mapped[str] = mapped_column(String(20), default="warning", index=True)
    status: Mapped[str] = mapped_column(String(20), default="firing", index=True)  # firing|resolved
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acked_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notifications: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "triggerId": self.trigger_id,
            "triggerName": self.trigger_name,
            "component": self.component,
            "target": self.target,
            "clusterId": self.cluster_id,
            "severity": self.severity,
            "status": self.status,
            "value": self.value,
            "threshold": self.threshold,
            "firedAt": (self.fired_at or _now()).isoformat(),
            "resolvedAt": self.resolved_at.isoformat() if self.resolved_at else None,
            "ackedAt": self.acked_at.isoformat() if self.acked_at else None,
            "ackedBy": self.acked_by,
            "notifications": self.notifications or [],
        }


class Dashboard(Base):
    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(String(120), primary_key=True, default=new_id)
    cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    spec: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def to_dict(self) -> dict[str, Any]:
        spec = self.spec or {}
        return {
            "id": self.id,
            "clusterId": self.cluster_id,
            "title": self.title,
            "builtin": False,
            "createdBy": self.created_by,
            "createdAt": (self.created_at or _now()).isoformat(),
            "updatedAt": (self.updated_at or _now()).isoformat(),
            **{k: v for k, v in spec.items() if k not in ("id", "title")},
        }


__all__ = [
    "AlertAction",
    "AlertHistory",
    "AlertTrigger",
    "AuditLog",
    "Base",
    "Dashboard",
    "KVStore",
    "SavedQuery",
    "User",
    "new_id",
]
