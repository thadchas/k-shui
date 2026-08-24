"""Kafka Connect REST client (Apache Kafka 3.x/4.x workers).

One :class:`ConnectClient` per configured Connect cluster; :func:`get_connect` resolves
and caches them on the :class:`ClusterContext`.
"""

from __future__ import annotations

import asyncio
from typing import Any

from k_shui.config import ConnectClusterConfig
from k_shui.core.errors import IntegrationNotConfigured, NotFound
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import HttpClient

COMPONENT = "kafka-connect"

MM2_CLASSES = {
    "org.apache.kafka.connect.mirror.MirrorSourceConnector": "source",
    "org.apache.kafka.connect.mirror.MirrorCheckpointConnector": "checkpoint",
    "org.apache.kafka.connect.mirror.MirrorHeartbeatConnector": "heartbeat",
}
REPLICATOR_CLASSES = {"io.confluent.connect.replicator.ReplicatorSourceConnector": "replicator"}


def _short_class(class_name: str) -> str:
    return class_name.rsplit(".", 1)[-1] if class_name else ""


class ConnectClient:
    """Async client for a single Kafka Connect REST endpoint."""

    def __init__(self, config: ConnectClusterConfig) -> None:
        self.config = config
        self.name = config.name
        self.url = config.url.rstrip("/")
        self.http = HttpClient(self.url, config.auth, component=f"{COMPONENT}[{config.name}]")

    async def aclose(self) -> None:
        await self.http.aclose()

    # ------------------------------------------------------------------ cluster

    async def root(self) -> dict[str, Any]:
        data = await self.http.get_json("/")
        return data if isinstance(data, dict) else {}

    async def cluster_summary(self) -> dict[str, Any]:
        """Row for ``GET /clusters/{c}/connect``: root info + connector/task rollup."""
        summary: dict[str, Any] = {
            "name": self.name,
            "url": self.url,
            "version": None,
            "commit": None,
            "kafkaClusterId": None,
            "status": "offline",
            "connectorCount": 0,
            "runningTasks": 0,
            "failedTasks": 0,
            "pausedTasks": 0,
            "failedConnectors": 0,
        }
        root = await self.http.try_json("/", default=None)
        if not isinstance(root, dict):
            return summary
        summary.update(
            {
                "version": root.get("version"),
                "commit": root.get("commit"),
                "kafkaClusterId": root.get("kafka_cluster_id"),
                "status": "online",
            }
        )
        expanded = await self.http.try_json(
            "/connectors", default={}, params=[("expand", "status"), ("expand", "info")]
        )
        if not isinstance(expanded, dict):
            return summary
        summary["connectorCount"] = len(expanded)
        for entry in expanded.values():
            status = (entry or {}).get("status") or {}
            if (status.get("connector") or {}).get("state") == "FAILED":
                summary["failedConnectors"] += 1
            for task in status.get("tasks") or []:
                state = task.get("state")
                if state == "RUNNING":
                    summary["runningTasks"] += 1
                elif state == "FAILED":
                    summary["failedTasks"] += 1
                elif state == "PAUSED":
                    summary["pausedTasks"] += 1
        return summary

    # --------------------------------------------------------------- connectors

    async def list_connector_names(self) -> list[str]:
        data = await self.http.get_json("/connectors")
        return [str(n) for n in (data or [])]

    async def list_connectors(
        self, search: str | None = None, state: str | None = None, type_: str | None = None
    ) -> list[dict[str, Any]]:
        data = await self.http.get_json("/connectors", params=[("expand", "status"), ("expand", "info")])
        if not isinstance(data, dict):  # very old workers ignore ?expand
            names = [str(n) for n in (data or [])]
            rows = await asyncio.gather(*(self.connector(n) for n in names), return_exceptions=True)
            connectors = [r for r in rows if isinstance(r, dict)]
        else:
            connectors = [self._merge(name, entry) for name, entry in sorted(data.items())]
        if search:
            needle = search.lower()
            connectors = [c for c in connectors if needle in c["name"].lower()]
        if state:
            wanted = state.upper()
            connectors = [c for c in connectors if (c.get("state") or "").upper() == wanted]
        if type_:
            connectors = [c for c in connectors if c.get("type") == type_.lower()]
        return connectors

    def _merge(self, name: str, entry: dict[str, Any]) -> dict[str, Any]:
        info = (entry or {}).get("info") or {}
        status = (entry or {}).get("status") or {}
        config = info.get("config") or {}
        connector = status.get("connector") or {}
        tasks = [
            {
                "id": t.get("id"),
                "state": t.get("state"),
                "workerId": t.get("worker_id"),
                "trace": t.get("trace"),
            }
            for t in (status.get("tasks") or [])
        ]
        topics = self._topics_from_config(config)
        return {
            "name": name,
            "type": status.get("type") or info.get("type") or "source",
            "connectorClass": config.get("connector.class"),
            "connectorClassShort": _short_class(config.get("connector.class", "")),
            "state": connector.get("state", "UNASSIGNED"),
            "workerId": connector.get("worker_id"),
            "trace": connector.get("trace"),
            "tasksMax": _to_int(config.get("tasks.max")),
            "taskCount": len(tasks),
            "runningTasks": sum(1 for t in tasks if t["state"] == "RUNNING"),
            "failedTasks": sum(1 for t in tasks if t["state"] == "FAILED"),
            "tasks": tasks,
            "topics": topics,
            "config": config,
        }

    @staticmethod
    def _topics_from_config(config: dict[str, Any]) -> list[str]:
        raw = config.get("topics") or config.get("topic") or ""
        topics = [t.strip() for t in str(raw).split(",") if t.strip()]
        if not topics and config.get("topics.regex"):
            topics = [f"~{config['topics.regex']}"]
        return topics

    async def connector(self, name: str) -> dict[str, Any]:
        """Merged info + status + active topics for one connector."""
        info, status, topics = await asyncio.gather(
            self.http.get_json(f"/connectors/{name}"),
            self.http.try_json(f"/connectors/{name}/status", default={}),
            self.topics(name),
            return_exceptions=True,
        )
        if isinstance(info, BaseException):
            raise info
        merged = self._merge(name, {"info": info, "status": status if isinstance(status, dict) else {}})
        if isinstance(topics, list) and topics:
            merged["topics"] = sorted(set(merged["topics"]) | set(topics))
        return merged

    async def get_config(self, name: str) -> dict[str, Any]:
        """Connector config (named ``get_config`` because ``self.config`` is the cluster config)."""
        data = await self.http.get_json(f"/connectors/{name}/config")
        return data if isinstance(data, dict) else {}

    async def status(self, name: str) -> dict[str, Any]:
        data = await self.http.get_json(f"/connectors/{name}/status")
        return data if isinstance(data, dict) else {}

    async def create(self, name: str, config: dict[str, Any]) -> dict[str, Any]:
        payload = {"name": name, "config": {**config, "name": name}}
        data = await self.http.post_json("/connectors", json=payload)
        return data if isinstance(data, dict) else {}

    async def put_config(self, name: str, config: dict[str, Any]) -> dict[str, Any]:
        data = await self.http.put_json(f"/connectors/{name}/config", json=config)
        return data if isinstance(data, dict) else {}

    async def delete(self, name: str) -> None:
        await self.http.send("DELETE", f"/connectors/{name}")

    async def pause(self, name: str) -> None:
        await self.http.send("PUT", f"/connectors/{name}/pause")

    async def resume(self, name: str) -> None:
        await self.http.send("PUT", f"/connectors/{name}/resume")

    async def stop(self, name: str) -> None:
        """Kafka 3.5+ ``STOPPED`` state; falls back to pause on older workers."""
        resp = await self.http.request("PUT", f"/connectors/{name}/stop")
        if resp.status_code in (404, 405):
            await self.pause(name)
            return
        from k_shui.integrations.http import raise_upstream

        raise_upstream(resp, component=self.http.component)

    async def restart(
        self, name: str, include_tasks: bool = False, only_failed: bool = False
    ) -> dict[str, Any]:
        params = {
            "includeTasks": "true" if include_tasks else "false",
            "onlyFailed": "true" if only_failed else "false",
        }
        resp = await self.http.send("POST", f"/connectors/{name}/restart", params=params)
        if resp.status_code == 204 or not resp.content:
            return {"restarted": True, "name": name}
        try:
            return resp.json()
        except ValueError:
            return {"restarted": True, "name": name}

    async def restart_task(self, name: str, task_id: int) -> None:
        await self.http.send("POST", f"/connectors/{name}/tasks/{task_id}/restart")

    async def tasks(self, name: str) -> list[dict[str, Any]]:
        data = await self.http.get_json(f"/connectors/{name}/tasks")
        return list(data or [])

    # ------------------------------------------------------------ topics/offsets

    async def topics(self, name: str) -> list[str]:
        data = await self.http.try_json(f"/connectors/{name}/topics", default={}) or {}
        entry = data.get(name) or {}
        return [str(t) for t in (entry.get("topics") or [])]

    async def reset_topics(self, name: str) -> None:
        await self.http.send("PUT", f"/connectors/{name}/topics/reset")

    async def offsets(self, name: str) -> dict[str, Any]:
        data = await self.http.get_json(f"/connectors/{name}/offsets")
        return data if isinstance(data, dict) else {"offsets": []}

    async def patch_offsets(self, name: str, offsets: list[dict[str, Any]]) -> dict[str, Any]:
        data = await self.http.json("PATCH", f"/connectors/{name}/offsets", json={"offsets": offsets})
        return data if isinstance(data, dict) else {}

    async def delete_offsets(self, name: str) -> dict[str, Any]:
        data = await self.http.delete_json(f"/connectors/{name}/offsets")
        return data if isinstance(data, dict) else {}

    # ------------------------------------------------------------------ plugins

    async def plugins(self) -> list[dict[str, Any]]:
        data = await self.http.get_json("/connector-plugins")
        return [
            {
                "class": p.get("class"),
                "classShort": _short_class(p.get("class", "")),
                "type": p.get("type"),
                "version": p.get("version"),
            }
            for p in (data or [])
            if isinstance(p, dict)
        ]

    async def validate(self, plugin_class: str, config: dict[str, Any]) -> dict[str, Any]:
        payload = {**config, "connector.class": config.get("connector.class", plugin_class)}
        data = await self.http.put_json(f"/connector-plugins/{plugin_class}/config/validate", json=payload)
        if not isinstance(data, dict):
            return {"name": plugin_class, "errorCount": 0, "groups": [], "configs": []}
        return {
            "name": data.get("name", plugin_class),
            "errorCount": data.get("error_count", 0),
            "groups": data.get("groups", []),
            "configs": [_normalise_config_entry(c) for c in data.get("configs", [])],
        }


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalise_config_entry(entry: dict[str, Any]) -> dict[str, Any]:
    definition = entry.get("definition") or {}
    value = entry.get("value") or {}
    return {
        "definition": {
            "name": definition.get("name"),
            "type": definition.get("type"),
            "required": definition.get("required", False),
            "defaultValue": definition.get("default_value"),
            "importance": definition.get("importance"),
            "documentation": definition.get("documentation"),
            "group": definition.get("group"),
            "width": definition.get("width"),
            "displayName": definition.get("display_name"),
            "dependents": definition.get("dependents", []),
            "order": definition.get("order"),
        },
        "value": {
            "name": value.get("name"),
            "value": value.get("value"),
            "recommendedValues": value.get("recommended_values", []),
            "errors": value.get("errors", []),
            "visible": value.get("visible", True),
        },
    }


def get_connect(ctx: ClusterContext, connect_name: str) -> ConnectClient:
    """Resolve one configured Connect cluster by name (cached on the context)."""
    config = next((c for c in ctx.config.connect if c.name == connect_name), None)
    if config is None:
        if not ctx.config.connect:
            raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no Kafka Connect configured")
        raise NotFound(f"connect cluster '{connect_name}' not found in cluster '{ctx.id}'")
    return ctx.client(f"connect:{connect_name}", lambda _c: ConnectClient(config))


def all_connects(ctx: ClusterContext) -> list[ConnectClient]:
    return [get_connect(ctx, c.name) for c in ctx.config.connect]
