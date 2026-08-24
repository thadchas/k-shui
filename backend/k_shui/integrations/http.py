"""Shared async HTTP plumbing for every k-shui integration.

All upstream integrations (Schema Registry, Kafka Connect, ksqlDB, Flink, Prometheus,
Marquez) talk HTTP/JSON. This module centralises:

* client construction with auth from :class:`k_shui.config.HttpAuth`
* sensible timeouts + one automatic retry on transport (connect) errors
* translation of non-2xx responses into RFC 9457 problem errors
  (:class:`k_shui.core.errors.UpstreamError` / ``IntegrationUnavailable``)
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Any

import httpx

from k_shui.config import HttpAuth
from k_shui.core.errors import IntegrationUnavailable, NotFound, UpstreamError

try:  # pragma: no cover - structlog is a hard dep but keep the fallback honest
    import structlog

    log = structlog.get_logger(__name__)
except Exception:  # pragma: no cover
    import logging

    log = logging.getLogger(__name__)  # type: ignore[assignment]

DEFAULT_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=5.0)
LONG_TIMEOUT = httpx.Timeout(connect=5.0, read=300.0, write=300.0, pool=5.0)

__all__ = [
    "DEFAULT_TIMEOUT",
    "LONG_TIMEOUT",
    "HttpClient",
    "auth_headers",
    "build_client",
    "raise_upstream",
]


def auth_headers(auth: HttpAuth | None) -> dict[str, str]:
    """Basic/bearer headers for the configured auth (empty dict when unauthenticated)."""
    if auth is None:
        return {}
    if auth.bearerToken:
        return {"Authorization": f"Bearer {auth.bearerToken}"}
    if auth.username:
        import base64

        raw = f"{auth.username}:{auth.password or ''}".encode()
        return {"Authorization": "Basic " + base64.b64encode(raw).decode()}
    return {}


def build_client(
    base_url: str,
    auth: HttpAuth | None = None,
    *,
    timeout: httpx.Timeout | float = DEFAULT_TIMEOUT,
    headers: Mapping[str, str] | None = None,
    http2: bool = False,
) -> httpx.AsyncClient:
    """Create a configured :class:`httpx.AsyncClient` for an upstream integration."""
    merged: dict[str, str] = {"Accept": "application/json"}
    merged.update(auth_headers(auth))
    if headers:
        merged.update(headers)
    kwargs: dict[str, Any] = {
        "base_url": base_url.rstrip("/"),
        "timeout": timeout,
        "headers": merged,
        "follow_redirects": True,
    }
    if http2:
        try:  # h2 is optional; silently fall back to HTTP/1.1 chunked mode
            import h2  # noqa: F401

            kwargs["http2"] = True
        except Exception:
            pass
    return httpx.AsyncClient(**kwargs)


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        text = (resp.text or "").strip()
        return text[:500] or f"HTTP {resp.status_code}"
    if isinstance(body, dict):
        for key in ("message", "error_message", "detail", "errorMessage", "error", "title", "@error"):
            value = body.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, dict) and isinstance(value.get("message"), str):
                return value["message"]
    return json.dumps(body)[:500]


def raise_upstream(resp: httpx.Response, *, component: str = "upstream", not_found_ok: bool = False) -> None:
    """Convert a non-2xx upstream response into a k-shui problem error.

    ``404`` becomes :class:`NotFound` (unless ``not_found_ok``), ``5xx`` becomes
    :class:`IntegrationUnavailable`, everything else :class:`UpstreamError`.
    """
    if resp.is_success:
        return
    detail = _detail(resp)
    upstream = {"component": component, "upstreamStatus": resp.status_code, "upstreamUrl": str(resp.url)}
    if resp.status_code == 404 and not not_found_ok:
        raise NotFound(detail, **upstream)
    if resp.status_code >= 500:
        raise IntegrationUnavailable(f"{component}: {detail}", **upstream)
    raise UpstreamError(f"{component}: {detail}", **upstream)


class HttpClient:
    """Thin retrying wrapper around :class:`httpx.AsyncClient`.

    Retries **once** on transport errors (connection reset / DNS blip), which covers the
    common case of a keep-alive connection being closed by the upstream between calls.
    """

    def __init__(
        self,
        base_url: str,
        auth: HttpAuth | None = None,
        *,
        component: str = "upstream",
        timeout: httpx.Timeout | float = DEFAULT_TIMEOUT,
        headers: Mapping[str, str] | None = None,
        http2: bool = False,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.component = component
        self._client = build_client(base_url, auth, timeout=timeout, headers=headers, http2=http2)

    @property
    def raw(self) -> httpx.AsyncClient:
        return self._client

    async def aclose(self) -> None:
        await self._client.aclose()

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """Send a request, retrying once on transport failure. Does not check status."""
        try:
            return await self._client.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            log.debug("http retry", component=self.component, url=url, error=str(exc))
            try:
                return await self._client.request(method, url, **kwargs)
            except httpx.TransportError as exc2:
                raise IntegrationUnavailable(
                    f"{self.component} unreachable at {self.base_url}: {exc2}",
                    component=self.component,
                    upstreamUrl=self.base_url,
                ) from exc2

    async def send(
        self, method: str, url: str, *, not_found_ok: bool = False, **kwargs: Any
    ) -> httpx.Response:
        """Send a request and raise a problem error for non-2xx responses."""
        resp = await self.request(method, url, **kwargs)
        raise_upstream(resp, component=self.component, not_found_ok=not_found_ok)
        return resp

    async def json(self, method: str, url: str, **kwargs: Any) -> Any:
        """Send a request and decode the JSON body (``None`` for empty bodies)."""
        resp = await self.send(method, url, **kwargs)
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise UpstreamError(
                f"{self.component}: invalid JSON from {resp.url}", component=self.component
            ) from exc

    async def get_json(self, url: str, **kwargs: Any) -> Any:
        return await self.json("GET", url, **kwargs)

    async def post_json(self, url: str, **kwargs: Any) -> Any:
        return await self.json("POST", url, **kwargs)

    async def put_json(self, url: str, **kwargs: Any) -> Any:
        return await self.json("PUT", url, **kwargs)

    async def delete_json(self, url: str, **kwargs: Any) -> Any:
        return await self.json("DELETE", url, **kwargs)

    async def try_json(self, url: str, default: Any = None, **kwargs: Any) -> Any:
        """GET returning ``default`` instead of raising — for optional/best-effort calls."""
        try:
            resp = await self.request("GET", url, **kwargs)
        except Exception:
            return default
        if not resp.is_success or not resp.content:
            return default
        try:
            return resp.json()
        except ValueError:
            return default

    @asynccontextmanager
    async def stream(self, method: str, url: str, **kwargs: Any) -> AsyncIterator[httpx.Response]:
        """Stream a response body; raises a problem error on non-2xx."""
        try:
            async with self._client.stream(method, url, **kwargs) as resp:
                if not resp.is_success:
                    await resp.aread()
                    raise_upstream(resp, component=self.component)
                yield resp
        except httpx.TransportError as exc:
            raise IntegrationUnavailable(
                f"{self.component} unreachable at {self.base_url}: {exc}", component=self.component
            ) from exc

    async def reachable(self, path: str = "/") -> bool:
        try:
            resp = await self._client.get(path)
        except Exception:
            return False
        return resp.status_code < 500
