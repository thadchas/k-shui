"""RFC 9457 problem+json errors and exception handlers."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse

PROBLEM_BASE = "https://k-shui.dev/problems/"


class KShuiError(Exception):
    status: int = 500
    type: str = "internal-error"
    title: str = "Internal error"

    def __init__(self, detail: str | None = None, **extra: Any) -> None:
        super().__init__(detail or self.title)
        self.detail = detail or self.title
        self.extra = extra


class NotFound(KShuiError):
    status, type, title = 404, "not-found", "Not found"


class Conflict(KShuiError):
    status, type, title = 409, "conflict", "Conflict"


class BadRequest(KShuiError):
    status, type, title = 400, "bad-request", "Bad request"


class Forbidden(KShuiError):
    status, type, title = 403, "forbidden", "Forbidden"


class ReadOnly(KShuiError):
    status, type, title = 403, "read-only", "Read-only mode"


class IntegrationUnavailable(KShuiError):
    status, type, title = 503, "integration-unavailable", "Integration unavailable"


class IntegrationNotConfigured(KShuiError):
    status, type, title = 404, "integration-not-configured", "Integration not configured"


class UpstreamError(KShuiError):
    status, type, title = 502, "upstream-error", "Upstream error"


def problem(status: int, type_: str, title: str, detail: str, instance: str, **extra: Any) -> JSONResponse:
    body = {
        "type": PROBLEM_BASE + type_,
        "title": title,
        "status": status,
        "detail": detail,
        "instance": instance,
    }
    body.update(extra)
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(KShuiError)
    async def _kshui(request: Request, exc: KShuiError) -> JSONResponse:
        return problem(exc.status, exc.type, exc.title, exc.detail, str(request.url.path), **exc.extra)

    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException) -> JSONResponse:
        return problem(exc.status_code, "http-error", "Error", str(exc.detail), str(request.url.path))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return problem(
            422,
            "validation-error",
            "Validation error",
            "Invalid request",
            str(request.url.path),
            errors=exc.errors(),
        )
