"""Minimal async Schema Registry client used **only for (de)serialization**.

Works against any Confluent-compatible endpoint (Confluent SR, Apicurio ``ccompat``,
Karapace). The full management client lives in ``k_shui.integrations.schema_registry``.
"""

from __future__ import annotations

from typing import Any

import httpx
from cachetools import TTLCache

from k_shui.core.errors import IntegrationNotConfigured, UpstreamError
from k_shui.core.logging import get_logger
from k_shui.core.registry import ClusterContext

log = get_logger(__name__)

ACCEPT = "application/vnd.schemaregistry.v1+json, application/json"


class SerdeRegistryClient:
    """Read-only schema lookups with an in-memory TTL cache."""

    def __init__(
        self, url: str, auth: tuple[str, str] | None = None, headers: dict[str, str] | None = None
    ) -> None:
        self.url = url.rstrip("/")
        self._auth = auth
        self._headers = {"Accept": ACCEPT, **(headers or {})}
        self._client: httpx.AsyncClient | None = None
        self._by_id: TTLCache[int, dict[str, Any]] = TTLCache(maxsize=512, ttl=600)
        self._by_subject: TTLCache[str, dict[str, Any]] = TTLCache(maxsize=512, ttl=60)

    @classmethod
    def from_context(cls, ctx: ClusterContext) -> SerdeRegistryClient:
        sr = ctx.config.schemaRegistry
        if sr is None:
            raise IntegrationNotConfigured(f"schema registry not configured for cluster '{ctx.config.id}'")
        auth = None
        headers: dict[str, str] = {}
        if sr.auth:
            if sr.auth.username:
                auth = (sr.auth.username, sr.auth.password or "")
            if sr.auth.bearerToken:
                headers["Authorization"] = f"Bearer {sr.auth.bearerToken}"
        return cls(sr.url, auth, headers)

    @staticmethod
    def get(ctx: ClusterContext) -> SerdeRegistryClient | None:
        if ctx.config.schemaRegistry is None:
            return None
        return ctx.client("serde_registry", SerdeRegistryClient.from_context)

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.url, auth=self._auth, headers=self._headers, timeout=httpx.Timeout(10.0)
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str) -> Any:
        try:
            resp = await self.client.get(path)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"schema registry unreachable: {exc}") from exc
        if resp.status_code == 404:
            raise UpstreamError(f"schema registry 404 for {path}")
        if resp.status_code >= 400:
            raise UpstreamError(f"schema registry {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    async def get_schema_by_id(self, schema_id: int) -> dict[str, Any]:
        """→ ``{id, schema, schemaType, references}``."""
        if schema_id in self._by_id:
            return self._by_id[schema_id]
        body = await self._get(f"/schemas/ids/{schema_id}")
        entry = {
            "id": schema_id,
            "schema": body.get("schema") or body.get("schemaString") or "",
            "schemaType": (body.get("schemaType") or "AVRO").upper(),
            "references": body.get("references") or [],
        }
        self._by_id[schema_id] = entry
        return entry

    async def get_latest(self, subject: str) -> dict[str, Any]:
        if subject in self._by_subject:
            return self._by_subject[subject]
        body = await self._get(f"/subjects/{subject}/versions/latest")
        entry = {
            "id": body.get("id"),
            "subject": body.get("subject", subject),
            "version": body.get("version"),
            "schema": body.get("schema") or "",
            "schemaType": (body.get("schemaType") or "AVRO").upper(),
            "references": body.get("references") or [],
        }
        self._by_subject[subject] = entry
        return entry

    async def subject_for(self, topic: str, is_key: bool) -> str:
        return f"{topic}-{'key' if is_key else 'value'}"


__all__ = ["SerdeRegistryClient"]
