"""ksqlDB REST client: statements, streaming queries and object listings."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from k_shui.config import KsqlConfig
from k_shui.core.errors import IntegrationNotConfigured, NotFound, UpstreamError
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import LONG_TIMEOUT, HttpClient

COMPONENT = "ksqldb"
KSQL_ACCEPT = "application/vnd.ksql.v1+json"
DELIMITED_ACCEPT = "application/vnd.ksqlapi.delimited.v1"


class KsqlClient:
    """Async client for one ksqlDB server."""

    def __init__(self, config: KsqlConfig) -> None:
        self.config = config
        self.name = config.name
        self.url = config.url.rstrip("/")
        self.http = HttpClient(
            self.url,
            config.auth,
            component=f"{COMPONENT}[{config.name}]",
            timeout=LONG_TIMEOUT,
            headers={"Accept": KSQL_ACCEPT},
            http2=True,
        )

    async def aclose(self) -> None:
        await self.http.aclose()

    # -------------------------------------------------------------------- info

    async def info(self) -> dict[str, Any]:
        data = await self.http.try_json("/info", default=None)
        info = (data or {}).get("KsqlServerInfo", {}) if isinstance(data, dict) else {}
        healthy = await self.http.try_json("/healthcheck", default=None)
        status = "UNREACHABLE"
        if data is not None:
            status = "RUNNING" if (healthy or {}).get("isHealthy", True) else "DEGRADED"
        return {
            "name": self.name,
            "url": self.url,
            "version": info.get("version"),
            "kafkaClusterId": info.get("kafkaClusterId"),
            "ksqlServiceId": info.get("ksqlServiceId"),
            "serverStatus": info.get("serverStatus", status),
            "healthy": bool((healthy or {}).get("isHealthy", data is not None)),
        }

    # -------------------------------------------------------------- statements

    async def statement(self, sql: str, properties: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Run a (non-streaming) statement through ``POST /ksql``."""
        payload: dict[str, Any] = {"ksql": sql if sql.rstrip().endswith(";") else sql + ";"}
        payload["streamsProperties"] = properties or {}
        resp = await self.http.request(
            "POST", "/ksql", json=payload, headers={"Content-Type": KSQL_ACCEPT, "Accept": KSQL_ACCEPT}
        )
        if not resp.is_success:
            raise _ksql_error(resp.status_code, resp.text)
        data = resp.json() if resp.content else []
        return list(data) if isinstance(data, list) else [data]

    async def _entities(self, sql: str, key: str) -> list[dict[str, Any]]:
        results = await self.statement(sql)
        for entry in results:
            if key in entry:
                return list(entry[key] or [])
        return []

    async def streams(self) -> list[dict[str, Any]]:
        rows = await self._entities("SHOW STREAMS EXTENDED;", "sourceDescriptions")
        if rows:
            return [_describe_summary(r, "STREAM") for r in rows]
        return [
            {
                "name": s.get("name"),
                "topic": s.get("topic"),
                "keyFormat": s.get("keyFormat"),
                "valueFormat": s.get("valueFormat"),
                "type": "STREAM",
                "windowed": s.get("isWindowed", False),
            }
            for s in await self._entities("SHOW STREAMS;", "streams")
        ]

    async def tables(self) -> list[dict[str, Any]]:
        rows = await self._entities("SHOW TABLES EXTENDED;", "sourceDescriptions")
        if rows:
            return [_describe_summary(r, "TABLE") for r in rows]
        return [
            {
                "name": t.get("name"),
                "topic": t.get("topic"),
                "keyFormat": t.get("keyFormat"),
                "valueFormat": t.get("valueFormat"),
                "type": "TABLE",
                "windowed": t.get("isWindowed", False),
            }
            for t in await self._entities("SHOW TABLES;", "tables")
        ]

    async def queries(self) -> list[dict[str, Any]]:
        rows = await self._entities("SHOW QUERIES;", "queries")
        return [
            {
                "id": q.get("id"),
                "queryString": q.get("queryString"),
                "sinks": q.get("sinks", []),
                "sinkKafkaTopics": q.get("sinkKafkaTopics", []),
                "state": q.get("state"),
                "statusCount": q.get("statusCount", {}),
                "queryType": q.get("queryType"),
            }
            for q in rows
        ]

    async def describe(self, name: str) -> dict[str, Any]:
        rows = await self._entities(f"DESCRIBE {name} EXTENDED;", "sourceDescription")
        if isinstance(rows, dict):
            return rows
        results = await self.statement(f"DESCRIBE {name} EXTENDED;")
        for entry in results:
            if "sourceDescription" in entry:
                return dict(entry["sourceDescription"])
        raise NotFound(f"ksql source '{name}' not found")

    async def terminate(self, query_id: str) -> list[dict[str, Any]]:
        return await self.statement(f"TERMINATE {query_id};")

    # ---------------------------------------------------------------- querying

    async def query_stream(
        self, sql: str, properties: dict[str, Any] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield ``{type, ...}`` events (``header``/``row``/``error``/``end``).

        Prefers the modern ``/query-stream`` endpoint (HTTP/2 or chunked delimited JSON)
        and falls back to the legacy chunked ``/query`` endpoint on 404/405.
        """
        payload = {"sql": sql if sql.rstrip().endswith(";") else sql + ";", "properties": properties or {}}
        headers = {"Content-Type": "application/json", "Accept": DELIMITED_ACCEPT}
        try:
            async with self.http.stream("POST", "/query-stream", json=payload, headers=headers) as resp:
                async for event in _parse_delimited(resp):
                    yield event
                yield {"type": "end"}
                return
        except NotFound:
            pass
        except UpstreamError as exc:
            if "405" not in str(exc):
                yield {"type": "error", "message": str(exc)}
                yield {"type": "end"}
                return
        async for event in self._legacy_query(sql, properties):
            yield event

    async def _legacy_query(
        self, sql: str, properties: dict[str, Any] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        payload = {
            "ksql": sql if sql.rstrip().endswith(";") else sql + ";",
            "streamsProperties": properties or {},
        }
        headers = {"Content-Type": KSQL_ACCEPT, "Accept": KSQL_ACCEPT}
        try:
            async with self.http.stream("POST", "/query", json=payload, headers=headers) as resp:
                async for event in _parse_legacy(resp):
                    yield event
        except Exception as exc:  # surface as an SSE error rather than a 500
            yield {"type": "error", "message": str(exc)}
        yield {"type": "end"}


def _describe_summary(desc: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "name": desc.get("name"),
        "topic": desc.get("topic"),
        "keyFormat": desc.get("keyFormat"),
        "valueFormat": desc.get("valueFormat"),
        "type": desc.get("type", kind),
        "windowed": desc.get("windowType") is not None,
        "partitions": desc.get("partitions"),
        "replication": desc.get("replication"),
        "fields": [
            {"name": f.get("name"), "type": (f.get("schema") or {}).get("type")}
            for f in desc.get("fields", [])
        ],
        "readQueries": [q.get("id") for q in desc.get("readQueries", [])],
        "writeQueries": [q.get("id") for q in desc.get("writeQueries", [])],
        "statement": desc.get("statement"),
    }


def _ksql_error(status: int, text: str) -> Exception:
    message = text[:500]
    try:
        body = json.loads(text)
        message = body.get("message") or body.get("error_message") or message
    except Exception:
        pass
    return UpstreamError(f"ksqldb: {message}", component=COMPONENT, upstreamStatus=status)


def _decode_line(raw: str) -> Any:
    """Decode one line of a chunked JSON stream.

    ksqlDB frames the legacy ``/query`` response as a JSON *array* streamed line by line,
    so a line may carry a leading ``[``, a trailing ``,`` and/or a trailing ``]``. The
    ``/query-stream`` protocol instead sends bare JSON arrays as rows, so the raw line is
    always tried first and array framing is only stripped as a fallback.
    """
    line = raw.strip()
    if not line or line in ("[", "]", ","):
        return None
    for candidate in (line, line.rstrip(","), line.lstrip("[").rstrip("],").strip()):
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


async def _parse_delimited(resp: Any) -> AsyncIterator[dict[str, Any]]:
    """Parse the ``/query-stream`` delimited-JSON protocol into SSE-shaped events."""
    header_seen = False
    columns: list[str] = []
    async for raw in resp.aiter_lines():
        item = _decode_line(raw)
        if item is None:
            continue
        if isinstance(item, dict) and ("columnNames" in item or "queryId" in item):
            columns = list(item.get("columnNames") or [])
            header_seen = True
            yield {
                "type": "header",
                "queryId": item.get("queryId"),
                "columnNames": columns,
                "columnTypes": item.get("columnTypes") or [],
            }
        elif isinstance(item, dict) and ("@type" in item or "message" in item):
            yield {"type": "error", "message": item.get("message") or json.dumps(item)}
        elif isinstance(item, list):
            if not header_seen:
                yield {"type": "header", "columnNames": [], "columnTypes": []}
                header_seen = True
            yield {"type": "row", "values": item, "row": dict(zip(columns, item, strict=False))}


async def _parse_legacy(resp: Any) -> AsyncIterator[dict[str, Any]]:
    """Parse the legacy chunked ``/query`` JSON-array protocol."""
    columns: list[str] = []
    async for raw in resp.aiter_lines():
        item = _decode_line(raw)
        if not isinstance(item, dict):
            continue
        if "header" in item:
            header = item["header"] or {}
            schema = str(header.get("schema") or "")
            columns = _columns_from_schema(schema)
            yield {
                "type": "header",
                "queryId": header.get("queryId"),
                "columnNames": columns,
                "columnTypes": _types_from_schema(schema),
            }
        elif "row" in item:
            values = (item["row"] or {}).get("columns", [])
            yield {"type": "row", "values": values, "row": dict(zip(columns, values, strict=False))}
        elif "errorMessage" in item or "message" in item:
            error = item.get("errorMessage") or item
            yield {
                "type": "error",
                "message": error.get("message") if isinstance(error, dict) else str(error),
            }
        elif "finalMessage" in item:
            yield {"type": "info", "message": item["finalMessage"]}


def _split_schema(schema: str) -> list[str]:
    parts, depth, current = [], 0, ""
    for char in schema:
        if char in "<(":
            depth += 1
        elif char in ">)":
            depth -= 1
        if char == "," and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += char
    if current.strip():
        parts.append(current.strip())
    return parts


def _columns_from_schema(schema: str) -> list[str]:
    return [p.split(" ", 1)[0].strip("`") for p in _split_schema(schema) if p]


def _types_from_schema(schema: str) -> list[str]:
    return [(p.split(" ", 1)[1] if " " in p else "STRING") for p in _split_schema(schema) if p]


def get_ksql(ctx: ClusterContext, name: str) -> KsqlClient:
    config = next((k for k in ctx.config.ksqldb if k.name == name), None)
    if config is None:
        if not ctx.config.ksqldb:
            raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no ksqlDB configured")
        raise NotFound(f"ksqlDB server '{name}' not found in cluster '{ctx.id}'")
    return ctx.client(f"ksql:{name}", lambda _c: KsqlClient(config))


def all_ksql(ctx: ClusterContext) -> list[KsqlClient]:
    return [get_ksql(ctx, k.name) for k in ctx.config.ksqldb]
