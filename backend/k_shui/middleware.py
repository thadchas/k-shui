"""Security headers, request logging and Prometheus instrumentation middleware."""

from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from k_shui.core.logging import get_logger
from k_shui.metrics import REQUEST_LATENCY, REQUESTS

log = get_logger("k_shui.request")

CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
)
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CSP,
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Structured access logs + `kshui_http_*` metrics, with a per-request id."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(requestId=request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers.setdefault("x-request-id", request_id)
            return response
        finally:
            elapsed = time.perf_counter() - started
            route = request.scope.get("route")
            path = getattr(route, "path", None) or request.url.path
            if not path.startswith(("/metrics", "/healthz", "/readyz")):
                log.info(
                    "http.request",
                    method=request.method,
                    path=request.url.path,
                    status=status,
                    durationMs=round(elapsed * 1000, 2),
                )
            REQUESTS.labels(method=request.method, path=path, status=str(status)).inc()
            REQUEST_LATENCY.labels(method=request.method, path=path).observe(elapsed)
            structlog.contextvars.clear_contextvars()


__all__ = ["RequestLoggingMiddleware", "SecurityHeadersMiddleware"]
