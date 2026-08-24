"""Database access shared by the integration-owned tables (alerts, dashboards).

``k_shui.db`` owns the engine and the declarative ``Base``, but it is written by another
module and may be absent or not yet initialised. Everything here therefore degrades:

* :func:`get_base` returns ``k_shui.db.models.Base`` when it exists, otherwise a private
  ``DeclarativeBase`` so the fallback models in ``alerts/models.py`` and
  ``dashboards/models.py`` can still be declared.
* :func:`session_scope` returns the shared session factory only when the database has
  actually been initialised; callers fall back to :mod:`k_shui.integrations.memstore`
  when it returns ``None``.
"""

from __future__ import annotations

from typing import Any


def get_base() -> Any:
    """The shared declarative base — ``k_shui.db.models.Base`` when available."""
    try:
        from k_shui.db.models import Base

        return Base
    except Exception:
        from sqlalchemy.orm import DeclarativeBase

        class _Base(DeclarativeBase):
            pass

        return _Base


def session_scope() -> Any:
    """The shared ``session_scope`` context manager, or ``None`` when there is no database."""
    try:
        from k_shui.db import session as db_session

        if db_session.is_ready():
            return db_session.session_scope
    except Exception:
        pass
    return None
