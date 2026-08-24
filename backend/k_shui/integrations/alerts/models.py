"""Alert ORM models.

``k_shui.db.models`` owns the real tables; this module re-exports them and declares
compatible fallbacks so the alerts package keeps working if that module is missing or
does not (yet) define the alert tables.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from k_shui.integrations.store import get_base

Base = get_base()

AlertTrigger: Any
AlertAction: Any
AlertHistory: Any
HAS_DB_MODELS = False


def new_id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


def _declare() -> tuple[Any, Any, Any]:  # pragma: no cover - only used without k_shui.db.models
    from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String
    from sqlalchemy.orm import Mapped, mapped_column

    class _Trigger(Base):  # type: ignore[misc, valid-type]
        __tablename__ = "alert_triggers"
        __table_args__ = {"extend_existing": True}

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
        name: Mapped[str] = mapped_column(String(300))
        cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
        component: Mapped[str] = mapped_column(String(40))
        target: Mapped[Any] = mapped_column(JSON, nullable=True)
        metric: Mapped[str] = mapped_column(String(200))
        condition: Mapped[str] = mapped_column(String(10), default="gt")
        value: Mapped[float] = mapped_column(Float, default=0.0)
        buffer_seconds: Mapped[int] = mapped_column(Integer, default=0)
        severity: Mapped[str] = mapped_column(String(20), default="warning")
        enabled: Mapped[bool] = mapped_column(Boolean, default=True)
        action_ids: Mapped[Any] = mapped_column(JSON, nullable=True)
        config: Mapped[Any] = mapped_column(JSON, nullable=True)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
        updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    class _Action(Base):  # type: ignore[misc, valid-type]
        __tablename__ = "alert_actions"
        __table_args__ = {"extend_existing": True}

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
        name: Mapped[str] = mapped_column(String(300))
        type: Mapped[str] = mapped_column(String(40))
        config: Mapped[Any] = mapped_column(JSON, nullable=True)
        enabled: Mapped[bool] = mapped_column(Boolean, default=True)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
        updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    class _History(Base):  # type: ignore[misc, valid-type]
        __tablename__ = "alert_history"
        __table_args__ = {"extend_existing": True}

        id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
        trigger_id: Mapped[str] = mapped_column(String(64))
        trigger_name: Mapped[str] = mapped_column(String(300), default="")
        component: Mapped[str] = mapped_column(String(40))
        target: Mapped[str | None] = mapped_column(String(500), nullable=True)
        cluster_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
        severity: Mapped[str] = mapped_column(String(20), default="warning")
        status: Mapped[str] = mapped_column(String(20), default="firing")
        value: Mapped[float | None] = mapped_column(Float, nullable=True)
        threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
        fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
        resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
        acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
        acked_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
        notifications: Mapped[Any] = mapped_column(JSON, nullable=True)

    return _Trigger, _Action, _History


try:
    from k_shui.db.models import AlertAction as _A
    from k_shui.db.models import AlertHistory as _H
    from k_shui.db.models import AlertTrigger as _T

    AlertTrigger, AlertAction, AlertHistory = _T, _A, _H
    HAS_DB_MODELS = True
except Exception:  # pragma: no cover
    AlertTrigger, AlertAction, AlertHistory = _declare()
