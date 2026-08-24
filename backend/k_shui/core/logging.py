"""structlog configuration (JSON or console renderer)."""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_configured = False


def configure_logging(fmt: str = "console", level: str = "INFO") -> None:
    """Configure stdlib logging + structlog once per process."""
    global _configured
    logging.basicConfig(
        format="%(message)s", stream=sys.stdout, level=getattr(logging, level.upper(), logging.INFO)
    )
    for noisy in ("uvicorn.access", "watchfiles.main"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if fmt == "json"
        else structlog.dev.ConsoleRenderer(colors=sys.stdout.isatty())
    )
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.INFO)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str | None = None) -> Any:
    if not _configured:
        configure_logging()
    logger = structlog.get_logger()
    return logger.bind(logger=name) if name else logger


SENSITIVE_HINTS = ("password", "secret", "token", "credential", "sasl.password", "ssl.key")


def mask(name: str, value: Any) -> Any:
    """Mask a config value whose name suggests it is sensitive."""
    if value in (None, ""):
        return value
    lowered = name.lower()
    if any(h in lowered for h in SENSITIVE_HINTS):
        return "********"
    return value
