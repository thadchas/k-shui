"""Confluent-compatible Schema Registry client.

Works against Confluent Schema Registry, Apicurio (``/apis/ccompat/v7``) and Karapace —
all three speak the same REST dialect. Differences that matter in practice:

* Apicurio/Karapace may answer ``404``/``501`` for ``/mode`` and per-subject ``/config``;
  we degrade to the global config instead of failing.
* ``schemaType`` is omitted for AVRO by Confluent, so it is normalised to ``"AVRO"``.
"""

from __future__ import annotations

import asyncio
import difflib
import json
import re
from typing import Any

from k_shui.config import SchemaRegistryConfig
from k_shui.core.errors import BadRequest, IntegrationNotConfigured, NotFound
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import HttpClient

COMPONENT = "schema-registry"
_KEY_VALUE_SUFFIX = re.compile(r"-(key|value)$")


def _schema_type(raw: Any) -> str:
    value = (raw or "AVRO") if isinstance(raw, str) or raw is None else "AVRO"
    return str(value).upper() or "AVRO"


def _pretty(schema: str, schema_type: str) -> str:
    """Pretty-print a schema string for diffing (JSON schemas get canonical indentation)."""
    if schema_type == "PROTOBUF":
        return schema
    try:
        return json.dumps(json.loads(schema), indent=2, sort_keys=True)
    except Exception:
        return schema


class SchemaRegistryClient:
    """Async management client for a Confluent-compatible schema registry."""

    def __init__(self, config: SchemaRegistryConfig) -> None:
        self.config = config
        self.url = config.url.rstrip("/")
        self.type = config.type
        self.http = HttpClient(self.url, config.auth, component=COMPONENT)

    async def aclose(self) -> None:
        await self.http.aclose()

    # ---------------------------------------------------------------- subjects

    async def list_subject_names(self, deleted: bool = False) -> list[str]:
        params = {"deleted": "true"} if deleted else None
        data = await self.http.get_json("/subjects", params=params)
        return [str(s) for s in (data or [])]

    async def list_versions(self, subject: str, deleted: bool = False) -> list[int]:
        params = {"deleted": "true"} if deleted else None
        data = await self.http.get_json(f"/subjects/{subject}/versions", params=params)
        return [int(v) for v in (data or [])]

    async def get_version(
        self, subject: str, version: int | str = "latest", deleted: bool = False
    ) -> dict[str, Any]:
        # Registries only serve a soft-deleted version when asked with ``?deleted=true``.
        params = {"deleted": "true"} if deleted else None
        data = await self.http.get_json(f"/subjects/{subject}/versions/{version}", params=params)
        return self._normalise_version(subject, data)

    async def get_versions(self, subject: str, deleted: bool = False) -> list[dict[str, Any]]:
        versions = await self.list_versions(subject, deleted=deleted)
        results = await asyncio.gather(
            *(self.get_version(subject, v, deleted=deleted) for v in versions),
            return_exceptions=True,
        )
        rows = [r for r in results if isinstance(r, dict)]
        if deleted and rows:
            # Not every registry flags ``deleted`` on the version payload; derive it from the
            # difference between the "all" and "live" version lists.
            try:
                live = set(await self.list_versions(subject, deleted=False))
            except NotFound:
                live = set()
            for row in rows:
                if not row.get("deleted"):
                    row["deleted"] = int(row["version"]) not in live
        return rows

    async def get_by_id(self, schema_id: int) -> dict[str, Any]:
        data = await self.http.get_json(f"/schemas/ids/{schema_id}")
        if not isinstance(data, dict):
            raise NotFound(f"schema id {schema_id} not found")
        subjects = await self.http.try_json(f"/schemas/ids/{schema_id}/versions", default=[])
        return {
            "id": schema_id,
            "schema": data.get("schema", ""),
            "schemaType": _schema_type(data.get("schemaType")),
            "references": data.get("references", []),
            "subjects": [
                {"subject": s.get("subject"), "version": s.get("version")}
                for s in (subjects or [])
                if isinstance(s, dict)
            ],
        }

    def _normalise_version(self, subject: str, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise NotFound(f"subject '{subject}' version not found")
        return {
            "subject": data.get("subject", subject),
            "version": data.get("version"),
            "id": data.get("id"),
            "schemaType": _schema_type(data.get("schemaType")),
            "schema": data.get("schema", ""),
            "references": data.get("references", []),
            "createdAt": data.get("createdAt") or data.get("timestamp"),
            "deleted": bool(data.get("deleted", False)),
        }

    async def subject_summary(self, subject: str, global_compat: str | None = None) -> dict[str, Any]:
        """One row for the subjects list: latest version + type + effective compatibility."""
        versions, latest, compat = await asyncio.gather(
            self.list_versions(subject),
            self.get_version(subject, "latest"),
            self.get_subject_config(subject),
            return_exceptions=True,
        )
        version_list = versions if isinstance(versions, list) else []
        latest_obj = latest if isinstance(latest, dict) else {}
        compat_obj = compat if isinstance(compat, dict) else {}
        topic = _KEY_VALUE_SUFFIX.sub("", subject) if _KEY_VALUE_SUFFIX.search(subject) else None
        return {
            "subject": subject,
            "latestVersion": latest_obj.get("version"),
            "schemaId": latest_obj.get("id"),
            "schemaType": latest_obj.get("schemaType", "AVRO"),
            "compatibility": compat_obj.get("compatibility") or global_compat or "BACKWARD",
            "compatibilityInherited": not compat_obj.get("explicit", False),
            "versionsCount": len(version_list),
            "topic": topic,
        }

    async def list_subjects(self, search: str | None = None, deleted: bool = False) -> list[dict[str, Any]]:
        names = await self.list_subject_names(deleted=deleted)
        if search:
            needle = search.lower()
            names = [n for n in names if needle in n.lower()]
        names.sort()
        global_config = await self.get_global_config()
        global_compat = global_config.get("compatibility")
        rows = await asyncio.gather(
            *(self.subject_summary(n, global_compat) for n in names), return_exceptions=True
        )
        return [r for r in rows if isinstance(r, dict)]

    async def subject_detail(self, subject: str, deleted: bool = False) -> dict[str, Any]:
        versions = await self.get_versions(subject, deleted=deleted)
        if not versions:
            if deleted:
                # Registries list soft-deleted versions but refuse to serve their payloads once
                # every version of the subject is deleted; a permanent delete clears the name.
                raise NotFound(
                    f"subject '{subject}' has only soft-deleted versions; the registry cannot "
                    "serve them. Delete the subject permanently to reclaim the name."
                )
            raise NotFound(f"subject '{subject}' has no versions")
        config = await self.get_subject_config(subject)
        if not config.get("compatibility"):
            config = await self.get_global_config()
        return {
            "subject": subject,
            "compatibility": config.get("compatibility", "BACKWARD"),
            "versions": sorted(versions, key=lambda v: v.get("version") or 0),
        }

    # -------------------------------------------------------------- mutations

    async def register(
        self,
        subject: str,
        schema: str,
        schema_type: str = "AVRO",
        references: list[dict[str, Any]] | None = None,
        normalize: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"schema": schema, "schemaType": _schema_type(schema_type)}
        if references:
            body["references"] = references
        params = {"normalize": "true"} if normalize else None
        data = await self.http.post_json(
            f"/subjects/{subject}/versions",
            json=body,
            params=params,
            headers={"Content-Type": "application/vnd.schemaregistry.v1+json"},
        )
        schema_id = (data or {}).get("id")
        latest = await self.http.try_json(f"/subjects/{subject}/versions/latest", default={})
        return {"id": schema_id, "subject": subject, "version": (latest or {}).get("version")}

    async def delete_subject(self, subject: str, permanent: bool = False) -> list[int]:
        params = {"permanent": "true"} if permanent else None
        if permanent:  # a permanent delete requires a prior soft delete
            await self.http.request("DELETE", f"/subjects/{subject}")
        data = await self.http.delete_json(f"/subjects/{subject}", params=params)
        return [int(v) for v in (data or [])]

    async def delete_version(self, subject: str, version: int | str, permanent: bool = False) -> int:
        params = {"permanent": "true"} if permanent else None
        if permanent:
            await self.http.request("DELETE", f"/subjects/{subject}/versions/{version}")
        data = await self.http.delete_json(f"/subjects/{subject}/versions/{version}", params=params)
        return int(data) if data is not None else 0

    async def check_compatibility(
        self,
        subject: str,
        schema: str,
        schema_type: str = "AVRO",
        references: list[dict[str, Any]] | None = None,
        version: str = "latest",
        normalize: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"schema": schema, "schemaType": _schema_type(schema_type)}
        if references:
            body["references"] = references
        params = {"verbose": "true"}
        if normalize:
            params["normalize"] = "true"
        resp = await self.http.request(
            "POST",
            f"/compatibility/subjects/{subject}/versions/{version}",
            json=body,
            params=params,
            headers={"Content-Type": "application/vnd.schemaregistry.v1+json"},
        )
        if resp.status_code == 404:  # brand new subject → nothing to be incompatible with
            return {"isCompatible": True, "messages": ["subject has no existing versions"]}
        if resp.status_code == 422:
            return {"isCompatible": False, "messages": [resp.text[:500]]}
        if not resp.is_success:
            from k_shui.integrations.http import raise_upstream

            raise_upstream(resp, component=COMPONENT)
        data = resp.json() if resp.content else {}
        messages = data.get("messages") or []
        if isinstance(messages, str):
            messages = [messages]
        return {
            "isCompatible": bool(data.get("is_compatible", data.get("isCompatible", False))),
            "messages": list(messages),
        }

    # ----------------------------------------------------------------- config

    async def get_global_config(self) -> dict[str, Any]:
        data = await self.http.try_json("/config", default={}) or {}
        return {
            "compatibility": data.get("compatibilityLevel") or data.get("compatibility") or "BACKWARD",
            "explicit": bool(data),
            "normalize": data.get("normalize"),
        }

    async def set_global_config(self, compatibility: str) -> dict[str, Any]:
        data = await self.http.put_json(
            "/config",
            json={"compatibility": compatibility.upper()},
            headers={"Content-Type": "application/vnd.schemaregistry.v1+json"},
        )
        return {"compatibility": (data or {}).get("compatibility", compatibility.upper()), "explicit": True}

    async def get_subject_config(self, subject: str) -> dict[str, Any]:
        """Per-subject config; ``explicit=False`` when the subject inherits the global level."""
        resp = await self.http.request("GET", f"/config/{subject}", params={"defaultToGlobal": "false"})
        if resp.status_code in (404, 405, 500, 501) or not resp.content:
            return {"compatibility": None, "explicit": False}
        try:
            data = resp.json()
        except ValueError:
            return {"compatibility": None, "explicit": False}
        if not isinstance(data, dict):
            return {"compatibility": None, "explicit": False}
        level = data.get("compatibilityLevel") or data.get("compatibility")
        return {"compatibility": level, "explicit": level is not None}

    async def set_subject_config(self, subject: str, compatibility: str) -> dict[str, Any]:
        data = await self.http.put_json(
            f"/config/{subject}",
            json={"compatibility": compatibility.upper()},
            headers={"Content-Type": "application/vnd.schemaregistry.v1+json"},
        )
        return {"compatibility": (data or {}).get("compatibility", compatibility.upper()), "explicit": True}

    async def delete_subject_config(self, subject: str) -> dict[str, Any]:
        """Drop the per-subject override so the subject inherits the global level again."""
        resp = await self.http.request("DELETE", f"/config/{subject}")
        if not resp.is_success and resp.status_code != 404:
            from k_shui.integrations.http import raise_upstream

            raise_upstream(resp, component=COMPONENT)
        global_config = await self.get_global_config()
        return {**global_config, "explicit": False}

    # ------------------------------------------------------------------- misc

    async def get_mode(self) -> str | None:
        data = await self.http.try_json("/mode", default=None)
        if isinstance(data, dict):
            return data.get("mode")
        return None

    async def info(self) -> dict[str, Any]:
        """Registry ``info`` per contract: ``{type, url, mode, version}`` + reachability."""
        mode, detected = await asyncio.gather(self.get_mode(), self._detect_server())
        config = await self.get_global_config()
        return {
            "type": self.config.type,
            "url": self.url,
            "mode": mode or "READWRITE",
            "version": detected.get("version"),
            "serverType": detected.get("serverType", self.config.type),
            "reachable": detected.get("reachable", False),
            "compatibility": config.get("compatibility"),
        }

    async def _detect_server(self) -> dict[str, Any]:
        """Best-effort server type/version detection across Confluent/Apicurio/Karapace."""
        result: dict[str, Any] = {"serverType": self.config.type, "reachable": False, "version": None}
        subjects = await self.http.try_json("/subjects", default=None)
        result["reachable"] = subjects is not None
        # Apicurio exposes a system info endpoint next to the ccompat base path.
        if "ccompat" in self.url:
            root = self.url.split("/apis/")[0]
            info = await self.http.try_json(f"{root}/apis/registry/v3/system/info", default=None)
            if isinstance(info, dict):
                result["serverType"] = "apicurio"
                result["version"] = info.get("version")
                return result
        confluent = await self.http.try_json("/v1/metadata/id", default=None)
        if isinstance(confluent, dict):
            result["serverType"] = "confluent"
            result["version"] = confluent.get("scope", {}).get("clusters", {}).get("schema-registry-cluster")
        return result

    async def diff(self, subject: str, from_version: int | str, to_version: int | str) -> dict[str, Any]:
        left, right = await asyncio.gather(
            self.get_version(subject, from_version), self.get_version(subject, to_version)
        )
        left_text = _pretty(left.get("schema", ""), left.get("schemaType", "AVRO"))
        right_text = _pretty(right.get("schema", ""), right.get("schemaType", "AVRO"))
        diff_lines = difflib.unified_diff(
            left_text.splitlines(),
            right_text.splitlines(),
            fromfile=f"{subject} v{left.get('version')}",
            tofile=f"{subject} v{right.get('version')}",
            lineterm="",
        )
        return {
            "subject": subject,
            "from": left.get("version"),
            "to": right.get("version"),
            "fromSchema": left_text,
            "toSchema": right_text,
            "identical": left_text == right_text,
            "unifiedDiff": "\n".join(diff_lines),
        }


def get_schema_registry(ctx: ClusterContext) -> SchemaRegistryClient:
    """Cached per-cluster registry client. Raises when the cluster has no registry."""
    if ctx.config.schemaRegistry is None:
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no schemaRegistry configured")

    def factory(c: ClusterContext) -> SchemaRegistryClient:
        assert c.config.schemaRegistry is not None
        return SchemaRegistryClient(c.config.schemaRegistry)

    return ctx.client("schema_registry", factory)


def parse_version(value: str) -> int | str:
    if value == "latest":
        return "latest"
    try:
        return int(value)
    except ValueError as exc:
        raise BadRequest(f"invalid schema version '{value}'") from exc
