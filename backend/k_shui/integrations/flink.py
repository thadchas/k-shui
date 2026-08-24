"""Apache Flink REST client (1.17 → 2.x) plus optional SQL Gateway proxy.

Flink's REST API mixes ``kebab-case`` (``start-time``), ``snake_case``
(``end_to_end_duration``) and ``camelCase`` keys. :func:`camelize` normalises everything
to camelCase for the frontend while leaving dotted configuration keys
(``taskmanager.numberOfTaskSlots``) untouched.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from k_shui.config import FlinkConfig
from k_shui.core.errors import IntegrationNotConfigured, NotFound
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import LONG_TIMEOUT, HttpClient

COMPONENT = "flink"
_SPLIT = re.compile(r"[-_]+")


def _camel_key(key: str) -> str:
    if "." in key or not _SPLIT.search(key):
        return key
    head, *rest = (p for p in _SPLIT.split(key) if p)
    if not head:
        return key
    return head[0].lower() + head[1:] + "".join(p[:1].upper() + p[1:] for p in rest)


def camelize(value: Any, depth: int = 0) -> Any:
    """Recursively camelCase every dict key (dotted config keys are preserved)."""
    if isinstance(value, dict):
        return {_camel_key(str(k)): camelize(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [camelize(v, depth + 1) for v in value]
    return value


class FlinkClient:
    """Async client for one Flink cluster (JobManager REST + optional SQL Gateway)."""

    def __init__(self, config: FlinkConfig) -> None:
        self.config = config
        self.name = config.name
        self.url = config.url.rstrip("/")
        self.sql_gateway_url = (config.sqlGatewayUrl or "").rstrip("/") or None
        self.http = HttpClient(
            self.url, config.auth, component=f"{COMPONENT}[{config.name}]", timeout=LONG_TIMEOUT
        )
        self._sql: HttpClient | None = None

    @property
    def sql(self) -> HttpClient:
        if self.sql_gateway_url is None:
            raise IntegrationNotConfigured(f"flink '{self.name}' has no sqlGatewayUrl configured")
        if self._sql is None:
            self._sql = HttpClient(
                self.sql_gateway_url,
                self.config.auth,
                component=f"flink-sql-gateway[{self.name}]",
                timeout=LONG_TIMEOUT,
            )
        return self._sql

    async def aclose(self) -> None:
        await self.http.aclose()
        if self._sql is not None:
            await self._sql.aclose()

    async def _get(self, path: str, **kwargs: Any) -> Any:
        return camelize(await self.http.get_json(path, **kwargs))

    # ---------------------------------------------------------------- overview

    async def overview(self) -> dict[str, Any]:
        return await self._get("/overview")

    async def cluster_config(self) -> dict[str, Any]:
        return await self._get("/config")

    async def summary(self) -> dict[str, Any]:
        """Row for ``GET /clusters/{c}/flink``."""
        row: dict[str, Any] = {
            "name": self.name,
            "url": self.url,
            "sqlGateway": self.sql_gateway_url is not None,
            "status": "offline",
            "version": None,
            "taskmanagers": 0,
            "slotsTotal": 0,
            "slotsAvailable": 0,
            "jobsRunning": 0,
            "jobsFinished": 0,
            "jobsCancelled": 0,
            "jobsFailed": 0,
        }
        data = await self.http.try_json("/overview", default=None)
        if not isinstance(data, dict):
            return row
        overview = camelize(data)
        row.update(
            {
                "status": "online",
                "version": overview.get("flinkVersion"),
                "commit": overview.get("flinkCommit"),
                "taskmanagers": overview.get("taskmanagers", 0),
                "slotsTotal": overview.get("slotsTotal", 0),
                "slotsAvailable": overview.get("slotsAvailable", 0),
                "jobsRunning": overview.get("jobsRunning", 0),
                "jobsFinished": overview.get("jobsFinished", 0),
                "jobsCancelled": overview.get("jobsCancelled", 0),
                "jobsFailed": overview.get("jobsFailed", 0),
            }
        )
        return row

    # -------------------------------------------------------------------- jobs

    async def jobs(self) -> list[dict[str, Any]]:
        data = await self._get("/jobs/overview")
        return list((data or {}).get("jobs", []))

    async def job_ids(self) -> list[dict[str, Any]]:
        data = await self._get("/jobs")
        return list((data or {}).get("jobs", []))

    async def job(self, jid: str) -> dict[str, Any]:
        data = await self._get(f"/jobs/{jid}")
        if not isinstance(data, dict):
            raise NotFound(f"flink job '{jid}' not found")
        return data

    async def job_plan(self, jid: str) -> dict[str, Any]:
        data = await self._get(f"/jobs/{jid}/plan")
        return (data or {}).get("plan", data or {})

    async def job_config(self, jid: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/config")

    async def checkpoints(self, jid: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/checkpoints")

    async def checkpoint_config(self, jid: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/checkpoints/config")

    async def checkpoint_detail(self, jid: str, checkpoint_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/checkpoints/details/{checkpoint_id}")

    async def exceptions(self, jid: str, max_exceptions: int = 20) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/exceptions", params={"maxExceptions": max_exceptions})

    async def job_metrics(self, jid: str, get: str | None = None) -> Any:
        params = {"get": get} if get else None
        return await self._get(f"/jobs/{jid}/metrics", params=params)

    async def accumulators(self, jid: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/accumulators")

    async def vertex(self, jid: str, vertex_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}")

    async def subtasks(self, jid: str, vertex_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}/subtasks/accumulators")

    async def subtask_times(self, jid: str, vertex_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}/subtasktimes")

    async def backpressure(self, jid: str, vertex_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}/backpressure")

    async def watermarks(self, jid: str, vertex_id: str) -> Any:
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}/watermarks")

    async def vertex_metrics(self, jid: str, vertex_id: str, get: str | None = None) -> Any:
        params = {"get": get} if get else None
        return await self._get(f"/jobs/{jid}/vertices/{vertex_id}/metrics", params=params)

    async def cancel(self, jid: str, mode: str = "cancel") -> dict[str, Any]:
        """``PATCH /jobs/{jid}?mode=cancel|stop`` (Flink's terminate endpoint)."""
        await self.http.send("PATCH", f"/jobs/{jid}", params={"mode": mode})
        return {"jid": jid, "mode": mode, "requested": True}

    async def trigger_savepoint(
        self, jid: str, target_directory: str | None = None, cancel_job: bool = False, drain: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"cancel-job": cancel_job}
        if target_directory:
            body["target-directory"] = target_directory
        if drain:
            body["drain"] = True
        data = await self.http.post_json(f"/jobs/{jid}/savepoints", json=body)
        return {"triggerId": (data or {}).get("request-id") or (data or {}).get("requestId"), "jid": jid}

    async def savepoint_status(self, jid: str, trigger_id: str) -> dict[str, Any]:
        return await self._get(f"/jobs/{jid}/savepoints/{trigger_id}")

    async def stop_with_savepoint(
        self, jid: str, target_directory: str | None = None, drain: bool = False
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"drain": drain}
        if target_directory:
            body["targetDirectory"] = target_directory
        data = await self.http.post_json(f"/jobs/{jid}/stop", json=body)
        return {"triggerId": (data or {}).get("request-id") or (data or {}).get("requestId"), "jid": jid}

    async def rescale(self, jid: str, parallelism: int) -> dict[str, Any]:
        data = await self.http.json("PATCH", f"/jobs/{jid}/rescaling", params={"parallelism": parallelism})
        return camelize(data or {})

    # ------------------------------------------------------------ task managers

    async def taskmanagers(self) -> list[dict[str, Any]]:
        data = await self._get("/taskmanagers")
        return list((data or {}).get("taskmanagers", []))

    async def taskmanager(self, tm_id: str) -> dict[str, Any]:
        return await self._get(f"/taskmanagers/{tm_id}")

    async def taskmanager_metrics(self, tm_id: str, get: str | None = None) -> Any:
        params = {"get": get} if get else None
        return await self._get(f"/taskmanagers/{tm_id}/metrics", params=params)

    async def taskmanager_logs(self, tm_id: str) -> dict[str, Any]:
        return await self._get(f"/taskmanagers/{tm_id}/logs")

    async def taskmanager_log(self, tm_id: str, filename: str) -> str:
        resp = await self.http.send("GET", f"/taskmanagers/{tm_id}/logs/{filename}")
        return resp.text

    async def taskmanager_thread_dump(self, tm_id: str) -> dict[str, Any]:
        return await self._get(f"/taskmanagers/{tm_id}/thread-dump")

    # -------------------------------------------------------------- jobmanager

    async def jobmanager_config(self) -> list[dict[str, Any]]:
        data = await self.http.get_json("/jobmanager/config")
        return list(data or [])

    async def jobmanager_metrics(self, get: str | None = None) -> Any:
        params = {"get": get} if get else None
        return await self._get("/jobmanager/metrics", params=params)

    async def jobmanager_logs(self) -> dict[str, Any]:
        return await self._get("/jobmanager/logs")

    async def jobmanager_log(self, filename: str | None = None) -> str:
        path = f"/jobmanager/logs/{filename}" if filename else "/jobmanager/log"
        resp = await self.http.send("GET", path)
        return resp.text

    async def jobmanager_thread_dump(self) -> dict[str, Any]:
        return await self._get("/jobmanager/thread-dump")

    # -------------------------------------------------------------------- jars

    async def jars(self) -> dict[str, Any]:
        return await self._get("/jars")

    async def upload_jar(self, filename: str, content: bytes) -> dict[str, Any]:
        files = {"jarfile": (filename, content, "application/x-java-archive")}
        data = await self.http.post_json("/jars/upload", files=files)
        return camelize(data or {})

    async def run_jar(self, jar_id: str, params: dict[str, Any]) -> dict[str, Any]:
        query = {k: v for k, v in params.items() if v is not None}
        data = await self.http.post_json(f"/jars/{jar_id}/run", params=query)
        return camelize(data or {})

    async def delete_jar(self, jar_id: str) -> None:
        await self.http.send("DELETE", f"/jars/{jar_id}")

    # ------------------------------------------------------------- sql gateway

    async def sql_info(self) -> dict[str, Any]:
        if self.sql_gateway_url is None:
            return {"supported": False, "reason": "sqlGatewayUrl not configured"}
        info = await self.sql.try_json("/v1/info", default=None)
        return {"supported": info is not None, "url": self.sql_gateway_url, "info": info}

    async def sql_session(self, properties: dict[str, Any] | None = None) -> dict[str, Any]:
        data = await self.sql.post_json("/v1/sessions", json={"properties": properties or {}})
        return {"sessionHandle": (data or {}).get("sessionHandle")}

    async def sql_statement(
        self, session: str, statement: str, properties: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"statement": statement}
        if properties:
            body["executionConfig"] = properties
        data = await self.sql.post_json(f"/v1/sessions/{session}/statements", json=body)
        return {"operationHandle": (data or {}).get("operationHandle")}

    async def sql_result(self, session: str, operation: str, token: int = 0) -> dict[str, Any]:
        data = await self.sql.get_json(f"/v1/sessions/{session}/operations/{operation}/result/{token}")
        return camelize(data or {})

    async def sql_cancel_operation(self, session: str, operation: str) -> dict[str, Any]:
        """Cancel a running gateway operation, then release it (``cancel`` + ``close``)."""
        cancelled = await self.sql.request("POST", f"/v1/sessions/{session}/operations/{operation}/cancel")
        closed = await self.sql.request("DELETE", f"/v1/sessions/{session}/operations/{operation}/close")
        return {
            "operationHandle": operation,
            "cancelled": cancelled.is_success,
            "closed": closed.is_success,
            "status": "CANCELED" if cancelled.is_success else "UNKNOWN",
        }

    async def sql_close_session(self, session: str) -> dict[str, Any]:
        data = await self.sql.delete_json(f"/v1/sessions/{session}")
        return camelize(data or {"status": "CLOSED"})


def get_flink(ctx: ClusterContext, name: str) -> FlinkClient:
    config = next((f for f in ctx.config.flink if f.name == name), None)
    if config is None:
        if not ctx.config.flink:
            raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no Flink configured")
        raise NotFound(f"flink cluster '{name}' not found in cluster '{ctx.id}'")
    return ctx.client(f"flink:{name}", lambda _c: FlinkClient(config))


def all_flink(ctx: ClusterContext) -> list[FlinkClient]:
    return [get_flink(ctx, f.name) for f in ctx.config.flink]


async def flink_summaries(ctx: ClusterContext) -> list[dict[str, Any]]:
    clients = all_flink(ctx)
    results = await asyncio.gather(*(c.summary() for c in clients), return_exceptions=True)
    rows: list[dict[str, Any]] = []
    for client, result in zip(clients, results, strict=False):
        rows.append(
            result
            if isinstance(result, dict)
            else {"name": client.name, "url": client.url, "status": "offline"}
        )
    return rows
