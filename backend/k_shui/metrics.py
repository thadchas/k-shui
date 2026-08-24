"""Prometheus metrics exposed at ``/metrics``."""

from __future__ import annotations

from typing import Any

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest

REGISTRY = CollectorRegistry(auto_describe=True)

REQUESTS = Counter(
    "kshui_http_requests_total", "HTTP requests handled", ["method", "path", "status"], registry=REGISTRY
)
REQUEST_LATENCY = Histogram(
    "kshui_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=REGISTRY,
)
CLUSTERS_ONLINE = Gauge("kshui_clusters_online", "Clusters currently reachable", registry=REGISTRY)
CLUSTERS_TOTAL = Gauge("kshui_clusters_total", "Configured clusters", registry=REGISTRY)
CLUSTER_UP = Gauge("kshui_cluster_up", "1 when the cluster is reachable", ["cluster"], registry=REGISTRY)
CLUSTER_TOPICS = Gauge("kshui_cluster_topics", "Topics per cluster", ["cluster"], registry=REGISTRY)
CLUSTER_PARTITIONS = Gauge(
    "kshui_cluster_partitions", "Partitions per cluster", ["cluster"], registry=REGISTRY
)
CLUSTER_URP = Gauge(
    "kshui_cluster_under_replicated_partitions", "Under-replicated partitions", ["cluster"], registry=REGISTRY
)
CLUSTER_OFFLINE_PARTITIONS = Gauge(
    "kshui_cluster_offline_partitions", "Offline partitions", ["cluster"], registry=REGISTRY
)
CLUSTER_BROKERS = Gauge("kshui_cluster_brokers", "Brokers per cluster", ["cluster"], registry=REGISTRY)
CONSUMER_LAG = Gauge(
    "kshui_consumer_group_lag", "Total lag per consumer group", ["cluster", "group"], registry=REGISTRY
)
ALERTS_FIRING = Gauge("kshui_alerts_firing", "Alerts currently firing", ["severity"], registry=REGISTRY)
SSE_CLIENTS = Gauge("kshui_sse_clients", "Connected SSE clients", registry=REGISTRY)


def refresh_from_samplers(manager: Any, bus: Any = None) -> None:
    """Copy the latest sampler snapshots into the gauges (called on /metrics scrape)."""
    if manager is None:
        return
    online = 0
    CLUSTERS_TOTAL.set(len(manager.samplers))
    for cluster_id, sampler in manager.samplers.items():
        sample = sampler.latest
        up = 1 if sample is not None and sample.error is None else 0
        online += up
        CLUSTER_UP.labels(cluster=cluster_id).set(up)
        if sample is None:
            continue
        CLUSTER_TOPICS.labels(cluster=cluster_id).set(sample.topics)
        CLUSTER_PARTITIONS.labels(cluster=cluster_id).set(sample.partitions)
        CLUSTER_URP.labels(cluster=cluster_id).set(sample.under_replicated)
        CLUSTER_OFFLINE_PARTITIONS.labels(cluster=cluster_id).set(sample.offline_partitions)
        CLUSTER_BROKERS.labels(cluster=cluster_id).set(sample.brokers)
        for group_id, lag in list(sample.per_group.items())[:500]:
            CONSUMER_LAG.labels(cluster=cluster_id, group=group_id).set(lag)
    CLUSTERS_ONLINE.set(online)
    if bus is not None:
        SSE_CLIENTS.set(bus.subscriber_count)


def render() -> bytes:
    return generate_latest(REGISTRY)


__all__ = [
    "ALERTS_FIRING",
    "CLUSTERS_ONLINE",
    "CONSUMER_LAG",
    "REGISTRY",
    "REQUESTS",
    "REQUEST_LATENCY",
    "refresh_from_samplers",
    "render",
]
