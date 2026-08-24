"""MirrorMaker2 / Confluent Replicator detection across the configured Connect clusters."""

from __future__ import annotations

import asyncio
from typing import Any

from k_shui.core.registry import ClusterContext
from k_shui.integrations.connect import (
    MM2_CLASSES,
    REPLICATOR_CLASSES,
    ConnectClient,
    all_connects,
)


def _alias(config: dict[str, Any], key: str, fallback_key: str) -> str | None:
    value = config.get(key) or config.get(fallback_key)
    return str(value) if value else None


def _host(bootstrap: Any) -> str | None:
    """Use the first broker host as a cluster alias when no explicit alias is configured."""
    if not bootstrap:
        return None
    return str(bootstrap).split(",")[0].split(":")[0] or None


def classify(config: dict[str, Any]) -> str | None:
    """Return the replication ``kind`` for a connector config, or ``None``."""
    connector_class = str(config.get("connector.class") or "")
    if connector_class in MM2_CLASSES:
        return MM2_CLASSES[connector_class]
    if connector_class in REPLICATOR_CLASSES:
        return REPLICATOR_CLASSES[connector_class]
    short = connector_class.rsplit(".", 1)[-1]
    for known, kind in MM2_CLASSES.items():
        if short == known.rsplit(".", 1)[-1]:
            return kind
    if short == "ReplicatorSourceConnector":
        return "replicator"
    return None


def _flow(connect_name: str, connector: dict[str, Any], kind: str) -> dict[str, Any]:
    config = connector.get("config") or {}
    source_bootstrap = config.get("source.cluster.bootstrap.servers") or config.get(
        "src.kafka.bootstrap.servers"
    )
    target_bootstrap = config.get("target.cluster.bootstrap.servers") or config.get(
        "dest.kafka.bootstrap.servers"
    )
    source = _alias(config, "source.cluster.alias", "src.cluster.alias") or _host(source_bootstrap)
    target = _alias(config, "target.cluster.alias", "dest.cluster.alias") or _host(target_bootstrap)
    return {
        "id": f"{connect_name}:{connector.get('name')}",
        "connectCluster": connect_name,
        "connectorName": connector.get("name"),
        "kind": kind,
        "connectorClass": config.get("connector.class"),
        "sourceAlias": source,
        "targetAlias": target,
        "sourceBootstrapServers": source_bootstrap,
        "targetBootstrapServers": target_bootstrap,
        "state": connector.get("state", "UNASSIGNED"),
        "topicsPattern": config.get("topics") or config.get("topic.whitelist") or config.get("topic.regex"),
        "topics": connector.get("topics") or [],
        "groupsPattern": config.get("groups") or config.get("group.whitelist"),
        "tasks": connector.get("taskCount", 0),
        "failedTasks": connector.get("failedTasks", 0),
        "replicationPolicy": config.get("replication.policy.class"),
    }


async def _scan(client: ConnectClient) -> list[dict[str, Any]]:
    try:
        connectors = await client.list_connectors()
    except Exception:
        return []
    flows = []
    for connector in connectors:
        kind = classify(connector.get("config") or {})
        if kind:
            flows.append(_flow(client.name, connector, kind))
    return flows


async def detect(ctx: ClusterContext) -> dict[str, Any]:
    """Summarise every MM2/Replicator connector found across the cluster's Connect workers."""
    clients = all_connects(ctx)
    if not clients:
        return {
            "supported": False,
            "detected": False,
            "flows": [],
            "links": [],
            "connectClusters": [],
            "reason": "no Kafka Connect cluster configured",
        }
    results = await asyncio.gather(*(_scan(c) for c in clients), return_exceptions=True)
    flows: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, list):
            flows.extend(result)

    links: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    for flow in flows:
        key = (flow["sourceAlias"], flow["targetAlias"])
        link = links.setdefault(
            key,
            {
                "id": f"{flow['sourceAlias'] or '?'}->{flow['targetAlias'] or '?'}",
                "source": flow["sourceAlias"],
                "target": flow["targetAlias"],
                "connectors": [],
                "kinds": [],
                "topics": [],
                "state": "RUNNING",
                "failedTasks": 0,
            },
        )
        link["connectors"].append(flow["connectorName"])
        if flow["kind"] not in link["kinds"]:
            link["kinds"].append(flow["kind"])
        link["topics"] = sorted(set(link["topics"]) | set(flow["topics"]))
        link["failedTasks"] += flow["failedTasks"]
        if flow["state"] != "RUNNING":
            link["state"] = flow["state"]

    return {
        "supported": True,
        "detected": bool(flows),
        "flows": sorted(flows, key=lambda f: f["id"]),
        "links": list(links.values()),
        "connectClusters": [c.name for c in clients],
    }
