"""Built-in Prometheus dashboards (Grafana-equivalent, defined as plain data).

Queries target the exporters that ship with a typical Kafka deployment:

* **Strimzi kafka-exporter** — ``kafka_consumergroup_*``, ``kafka_topic_partition_*``,
  ``kafka_brokers``
* **Kafka JMX exporter** (Strimzi's ``kafka-metrics`` rules) — ``kafka_server_*``,
  ``kafka_controller_*``, ``kafka_network_*``, ``kafka_log_*``, ``kafka_cluster_*``
* **Kafka Connect JMX exporter** — ``kafka_connect_*``
* **Flink Prometheus reporter** — ``flink_jobmanager_*`` / ``flink_taskmanager_*``
* **JMX exporter JVM collectors** — ``jvm_memory_used_bytes`` (older exporters expose
  ``jvm_memory_bytes_used``; both spellings are queried with ``or``).

Every panel is ``{id, title, type, unit, queries:[{expr, legend}], thresholds?}``.
"""

from __future__ import annotations

from typing import Any

from k_shui.integrations.dashboards.cluster import CLUSTER_OVERVIEW, KRAFT
from k_shui.integrations.dashboards.kafka import BROKERS, CONSUMER_LAG, TOPICS
from k_shui.integrations.dashboards.platform import CONNECT, FLINK, JVM

BUILTIN_DASHBOARDS: list[dict[str, Any]] = [
    CLUSTER_OVERVIEW,
    BROKERS,
    TOPICS,
    CONSUMER_LAG,
    CONNECT,
    FLINK,
    JVM,
    KRAFT,
]
BUILTIN_BY_ID: dict[str, dict[str, Any]] = {d["id"]: d for d in BUILTIN_DASHBOARDS}


def list_builtin() -> list[dict[str, Any]]:
    return [
        {
            "id": d["id"],
            "title": d["title"],
            "description": d.get("description", ""),
            "tags": d.get("tags", []),
            "builtin": True,
            "panelCount": sum(len(r.get("panels", [])) for r in d.get("rows", [])),
        }
        for d in BUILTIN_DASHBOARDS
    ]


def get_builtin(dashboard_id: str) -> dict[str, Any] | None:
    return BUILTIN_BY_ID.get(dashboard_id)


def iter_panels(dashboard: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for row in dashboard.get("rows", []) for p in row.get("panels", [])]
