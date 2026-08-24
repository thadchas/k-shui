"""Fallback SQLAlchemy model for user dashboards.

If ``k_shui.db.models`` already defines ``Dashboard`` we reuse it; otherwise we declare a
compatible table here (the columns match ARCHITECTURE.md).
"""

from __future__ import annotations

from typing import Any

from k_shui.integrations.store import get_base

Base = get_base()
Dashboard: Any


def _declare() -> Any:
    from sqlalchemy import JSON, Boolean, DateTime, String, func
    from sqlalchemy.orm import Mapped, mapped_column

    class _Dashboard(Base):  # type: ignore[misc, valid-type]
        __tablename__ = "dashboards"
        __table_args__ = {"extend_existing": True}

        id: Mapped[str] = mapped_column(String(128), primary_key=True)
        clusterId: Mapped[str | None] = mapped_column("cluster_id", String(128), nullable=True)
        title: Mapped[str] = mapped_column(String(256), default="")
        description: Mapped[str] = mapped_column(String(1024), default="")
        tags: Mapped[Any] = mapped_column(JSON, default=list)
        builtin: Mapped[bool] = mapped_column(Boolean, default=False)
        spec: Mapped[Any] = mapped_column(JSON, default=dict)
        createdAt: Mapped[Any] = mapped_column("created_at", DateTime, server_default=func.now())
        updatedAt: Mapped[Any] = mapped_column(
            "updated_at", DateTime, server_default=func.now(), onupdate=func.now()
        )

    return _Dashboard


try:  # pragma: no cover - depends on the other module landing first
    from k_shui.db.models import Dashboard as _Existing  # type: ignore[attr-defined]

    Dashboard = _Existing
except Exception:
    Dashboard = _declare()
