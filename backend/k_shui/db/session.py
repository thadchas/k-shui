"""Async SQLAlchemy engine/session management."""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from k_shui.config import Settings
from k_shui.core.logging import get_logger
from k_shui.db.models import Base

log = get_logger(__name__)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _engine_kwargs(url: str) -> dict[str, object]:
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


async def init_db(settings: Settings) -> AsyncEngine:
    """Create the engine and all tables. Safe to call repeatedly."""
    global _engine, _sessionmaker
    await close_db()
    url = settings.database.url
    _engine = create_async_engine(url, future=True, echo=False, **_engine_kwargs(url))  # type: ignore[arg-type]
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    log.info("db.ready", url=url.split("://", 1)[0])
    return _engine


async def close_db() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


def get_engine() -> AsyncEngine | None:
    return _engine


def is_ready() -> bool:
    return _sessionmaker is not None


def _require_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("database not initialised; call init_db(settings) first")
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session (commit on success, rollback on error)."""
    async with _require_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@contextlib.asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Context manager for background tasks and helpers."""
    async with _require_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


__all__ = ["close_db", "get_engine", "get_session", "init_db", "is_ready", "session_scope"]
