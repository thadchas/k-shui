"""ACLs, client quotas and SCRAM credentials — mixin for :class:`k_shui.kafka.admin.KafkaAdmin`.

Some of these APIs are missing from the installed confluent-kafka build; those degrade to
``{"supported": False}`` rather than raising.
"""

from __future__ import annotations

import asyncio
from typing import Any

from k_shui.core.errors import BadRequest, UpstreamError
from k_shui.core.logging import get_logger

log = get_logger(__name__)


def _enum(mod: Any, cls_name: str, value: str, default: str | None = None) -> Any:
    cls = getattr(mod, cls_name)
    raw = (value or default or "").upper().replace("-", "_")
    try:
        return cls[raw]
    except KeyError as exc:
        allowed = [m.name for m in cls]
        raise BadRequest(f"invalid {cls_name} '{value}'; allowed: {allowed}") from exc


def _acl_to_dict(binding: Any) -> dict[str, Any]:
    return {
        "resourceType": binding.restype.name.lower()
        if hasattr(binding.restype, "name")
        else str(binding.restype),
        "resourceName": binding.name,
        "patternType": binding.resource_pattern_type.name.lower(),
        "principal": binding.principal,
        "host": binding.host,
        "operation": binding.operation.name.lower(),
        "permissionType": binding.permission_type.name.lower(),
    }


class SecurityAdminMixin:
    """Requires ``self._admin`` and ``self._call`` from KafkaAdmin."""

    _admin: Any
    timeout: float

    async def _call(
        self, fn: Any, *args: Any, **kwargs: Any
    ) -> Any:  # pragma: no cover - provided by KafkaAdmin
        raise NotImplementedError

    # ------------------------------------------------------------------ ACLs
    def _binding_filter(self, spec: dict[str, Any], *, exact: bool) -> Any:
        from confluent_kafka import admin as ka

        cls = ka.AclBinding if exact else ka.AclBindingFilter
        return cls(
            _enum(ka, "ResourceType", spec.get("resourceType") or "", "ANY"),
            spec.get("resourceName") if spec.get("resourceName") else (None if not exact else ""),
            _enum(
                ka, "ResourcePatternType", spec.get("patternType") or "", "ANY" if not exact else "LITERAL"
            ),
            spec.get("principal") or None,
            spec.get("host") or ("*" if exact else None),
            _enum(ka, "AclOperation", spec.get("operation") or "", "ANY"),
            _enum(ka, "AclPermissionType", spec.get("permissionType") or "", "ANY" if not exact else "ALLOW"),
        )

    async def describe_acls(self, **filters: Any) -> list[dict[str, Any]]:
        try:
            fut = self._admin.describe_acls(
                self._binding_filter(filters, exact=False), request_timeout=self.timeout
            )
            result = await asyncio.to_thread(fut.result, self.timeout)
        except Exception as exc:
            if "SECURITY_DISABLED" in str(exc) or "not configured" in str(exc).lower():
                return []
            raise UpstreamError(f"describe_acls failed: {exc}") from exc
        return [_acl_to_dict(b) for b in result]

    async def create_acls(self, specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        from confluent_kafka import admin as ka

        bindings = [
            ka.AclBinding(
                _enum(ka, "ResourceType", s.get("resourceType") or "", "TOPIC"),
                s.get("resourceName") or "*",
                _enum(ka, "ResourcePatternType", s.get("patternType") or "", "LITERAL"),
                s.get("principal") or "",
                s.get("host") or "*",
                _enum(ka, "AclOperation", s.get("operation") or "", "ALL"),
                _enum(ka, "AclPermissionType", s.get("permissionType") or "", "ALLOW"),
            )
            for s in specs
        ]
        futures = self._admin.create_acls(bindings, request_timeout=self.timeout)
        out: list[dict[str, Any]] = []
        for binding, fut in futures.items():
            try:
                await asyncio.to_thread(fut.result, self.timeout)
                out.append({**_acl_to_dict(binding), "created": True})
            except Exception as exc:
                out.append({**_acl_to_dict(binding), "created": False, "error": str(exc)})
        return out

    async def delete_acls(self, **filters: Any) -> list[dict[str, Any]]:
        futures = self._admin.delete_acls(
            [self._binding_filter(filters, exact=False)], request_timeout=self.timeout
        )
        deleted: list[dict[str, Any]] = []
        for fut in futures.values():
            try:
                for binding in await asyncio.to_thread(fut.result, self.timeout):
                    deleted.append(_acl_to_dict(binding))
            except Exception as exc:
                raise UpstreamError(f"delete_acls failed: {exc}") from exc
        return deleted

    # ------------------------------------------------------------------ quotas
    async def describe_quotas(
        self, entity_type: str | None = None, entity_name: str | None = None
    ) -> dict[str, Any]:
        """Client quotas are not exposed by every confluent-kafka build."""
        if not hasattr(self._admin, "describe_client_quotas"):
            return {
                "supported": False,
                "items": [],
                "reason": "describe_client_quotas not available in confluent-kafka",
            }
        try:
            fut = self._admin.describe_client_quotas(request_timeout=self.timeout)  # type: ignore[attr-defined]
            result = await asyncio.to_thread(fut.result, self.timeout)
        except Exception as exc:
            raise UpstreamError(f"describe_client_quotas failed: {exc}") from exc
        items = []
        for entity, quotas in (result or {}).items():
            entry = {
                "entityType": getattr(entity, "entity_type", entity_type or "client-id"),
                "entityName": getattr(entity, "entity_name", entity_name),
                "quotas": dict(quotas or {}),
            }
            items.append(entry)
        return {"supported": True, "items": items}

    async def alter_quotas(
        self, entity_type: str, entity_name: str | None, quotas: dict[str, float | None]
    ) -> dict[str, Any]:
        if not hasattr(self._admin, "alter_client_quotas"):
            return {"supported": False, "reason": "alter_client_quotas not available in confluent-kafka"}
        try:
            fut = self._admin.alter_client_quotas(  # type: ignore[attr-defined]
                [{"entityType": entity_type, "entityName": entity_name, "quotas": quotas}],
                request_timeout=self.timeout,
            )
            await asyncio.to_thread(fut.result, self.timeout)
        except Exception as exc:
            raise UpstreamError(f"alter_client_quotas failed: {exc}") from exc
        return {"supported": True, "entityType": entity_type, "entityName": entity_name, "quotas": quotas}

    # ------------------------------------------------------------------ SCRAM
    async def describe_scram_users(self, users: list[str] | None = None) -> list[dict[str, Any]]:
        try:
            futures = self._admin.describe_user_scram_credentials(users or None, request_timeout=self.timeout)
        except Exception as exc:
            raise UpstreamError(f"describe_user_scram_credentials failed: {exc}") from exc
        if not isinstance(futures, dict):  # single future returning a mapping
            try:
                result = await asyncio.to_thread(futures.result, self.timeout)
            except Exception as exc:
                raise UpstreamError(f"describe_user_scram_credentials failed: {exc}") from exc
            futures = {u: _Immediate(d) for u, d in (result or {}).items()}
        out: list[dict[str, Any]] = []
        for username, fut in futures.items():
            try:
                desc = await asyncio.to_thread(fut.result, self.timeout)
            except Exception as exc:
                out.append({"username": username, "credentials": [], "error": str(exc)})
                continue
            creds = [
                {"mechanism": c.mechanism.name, "iterations": c.iterations}
                for c in getattr(desc, "scram_credential_infos", [])
            ]
            out.append({"username": username, "credentials": creds})
        return out

    async def upsert_scram_user(
        self, username: str, password: str, mechanism: str = "SCRAM_SHA_512", iterations: int = 4096
    ) -> dict[str, Any]:
        from confluent_kafka import admin as ka

        info = ka.ScramCredentialInfo(_enum(ka, "ScramMechanism", mechanism, "SCRAM_SHA_512"), iterations)
        alteration = ka.UserScramCredentialUpsertion(username, info, password)
        return await self._alter_scram([alteration], username)

    async def delete_scram_user(self, username: str, mechanism: str = "SCRAM_SHA_512") -> dict[str, Any]:
        from confluent_kafka import admin as ka

        alteration = ka.UserScramCredentialDeletion(
            username, _enum(ka, "ScramMechanism", mechanism, "SCRAM_SHA_512")
        )
        return await self._alter_scram([alteration], username)

    async def _alter_scram(self, alterations: list[Any], username: str) -> dict[str, Any]:
        try:
            futures = self._admin.alter_user_scram_credentials(alterations, request_timeout=self.timeout)
            for fut in futures.values() if isinstance(futures, dict) else [futures]:
                await asyncio.to_thread(fut.result, self.timeout)
        except Exception as exc:
            raise UpstreamError(f"alter_user_scram_credentials failed: {exc}") from exc
        return {"username": username, "ok": True}


class _Immediate:
    def __init__(self, value: Any) -> None:
        self._value = value

    def result(self, *_: Any) -> Any:
        return self._value


__all__ = ["SecurityAdminMixin"]
