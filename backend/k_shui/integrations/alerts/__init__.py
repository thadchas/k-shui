"""Alerting subsystem: metric catalog, evaluators, notifiers and the evaluation engine.

``main.py`` may call :func:`setup` to wire the engine into the FastAPI lifespan. If it
does not (or builds its own engine), the alerts router lazily starts one on the first API
call, so alerting works either way.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Any

from k_shui.integrations.alerts.engine import (
    AlertEngine,
    ensure_started,
    get_engine,
    start_alert_engine,
    stop_alert_engine,
)

__all__ = [
    "AlertEngine",
    "ensure_started",
    "get_engine",
    "setup",
    "start_alert_engine",
    "stop_alert_engine",
]


def setup(app: Any) -> None:
    """Run the alert engine for the lifetime of ``app``.

    Wraps the app's existing lifespan context rather than using ``on_event`` so it works
    with a custom ``lifespan=`` factory (which ignores startup/shutdown handlers).
    """
    if getattr(app.state, "alerts_setup", False):
        return
    app.state.alerts_setup = True
    previous = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def _lifespan(scoped_app: Any) -> AsyncIterator[Any]:
        async with previous(scoped_app) as state:
            with contextlib.suppress(Exception):
                await start_alert_engine(scoped_app)
            try:
                yield state
            finally:
                with contextlib.suppress(Exception):
                    await stop_alert_engine(scoped_app)

    app.router.lifespan_context = _lifespan
