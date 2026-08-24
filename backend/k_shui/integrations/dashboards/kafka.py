"""Built-in Kafka dashboards: per-broker, per-topic and consumer-group lag."""

from __future__ import annotations

from typing import Any

from k_shui.integrations.dashboards.panel import BROKER_AGG, panel

BROKERS: dict[str, Any] = {
    "id": "brokers",
    "title": "Brokers",
    "description": "Per-broker throughput, request latency, partition placement and log size.",
    "tags": ["kafka", "brokers"],
    "builtin": True,
    "variables": [{"name": "instance", "query": "label_values(kafka_brokers, instance)"}],
    "rows": [
        {
            "title": "Load",
            "panels": [
                panel(
                    "broker-bytes-in",
                    "Bytes in / sec per broker",
                    "timeseries",
                    "Bps",
                    [
                        (
                            f"sum by (pod, instance) "
                            f"(rate(kafka_server_brokertopicmetrics_bytesin_total{BROKER_AGG}[5m]))",
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "broker-bytes-out",
                    "Bytes out / sec per broker",
                    "timeseries",
                    "Bps",
                    [
                        (
                            f"sum by (pod, instance) "
                            f"(rate(kafka_server_brokertopicmetrics_bytesout_total{BROKER_AGG}[5m]))",
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "broker-partitions",
                    "Partitions per broker",
                    "timeseries",
                    "short",
                    [("kafka_server_replicamanager_partitioncount", "{{pod}}")],
                ),
                panel(
                    "broker-leaders",
                    "Leader partitions per broker",
                    "timeseries",
                    "short",
                    [("kafka_server_replicamanager_leadercount", "{{pod}}")],
                ),
            ],
        },
        {
            "title": "Latency & saturation",
            "panels": [
                panel(
                    "request-handler-idle",
                    "Request handler idle %",
                    "timeseries",
                    "percentunit",
                    [
                        (
                            "avg by (pod) "
                            "(kafka_server_kafkarequesthandlerpool_requesthandleravgidle_percent)",
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "network-processor-idle",
                    "Network processor idle %",
                    "timeseries",
                    "percentunit",
                    [
                        (
                            "avg by (pod) (kafka_network_socketserver_networkprocessoravgidle_percent)",
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "produce-latency",
                    "Produce total time (ms)",
                    "timeseries",
                    "ms",
                    [
                        (
                            'avg by (pod) (kafka_network_requestmetrics_totaltimems{request="Produce"})',
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "fetch-latency",
                    "Fetch consumer total time (ms)",
                    "timeseries",
                    "ms",
                    [
                        (
                            "avg by (pod) "
                            '(kafka_network_requestmetrics_totaltimems{request="FetchConsumer"})',
                            "{{pod}}",
                        )
                    ],
                ),
                panel(
                    "request-queue",
                    "Request queue size",
                    "timeseries",
                    "short",
                    [("sum by (pod) (kafka_network_requestchannel_requestqueuesize)", "{{pod}}")],
                ),
            ],
        },
        {
            "title": "Storage",
            "panels": [
                panel(
                    "log-size",
                    "Log size by broker",
                    "timeseries",
                    "bytes",
                    [("sum by (pod) (kafka_log_log_size)", "{{pod}}")],
                ),
                panel(
                    "log-segments",
                    "Log segments",
                    "timeseries",
                    "short",
                    [("sum by (pod) (kafka_log_log_numlogsegments)", "{{pod}}")],
                ),
                panel(
                    "offline-logdirs",
                    "Offline log directories",
                    "stat",
                    "short",
                    [("sum(kafka_log_logmanager_offlinelogdirectorycount)", "offline dirs")],
                ),
            ],
        },
    ],
}


TOPICS: dict[str, Any] = {
    "id": "topics",
    "title": "Topics",
    "description": "Per-topic throughput, size, partition offsets and replication health.",
    "tags": ["kafka", "topics"],
    "builtin": True,
    "variables": [{"name": "topic", "query": "label_values(kafka_topic_partitions, topic)"}],
    "rows": [
        {
            "title": "Throughput",
            "panels": [
                panel(
                    "topic-bytes-in",
                    "Bytes in / sec by topic",
                    "timeseries",
                    "Bps",
                    [
                        (
                            "sum by (topic) "
                            '(rate(kafka_server_brokertopicmetrics_bytesin_total{topic!=""}[5m]))',
                            "{{topic}}",
                        )
                    ],
                ),
                panel(
                    "topic-bytes-out",
                    "Bytes out / sec by topic",
                    "timeseries",
                    "Bps",
                    [
                        (
                            "sum by (topic) "
                            '(rate(kafka_server_brokertopicmetrics_bytesout_total{topic!=""}[5m]))',
                            "{{topic}}",
                        )
                    ],
                ),
                panel(
                    "topic-messages-in",
                    "Messages in / sec by topic",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum by (topic) "
                            '(rate(kafka_server_brokertopicmetrics_messagesin_total{topic!=""}[5m]))',
                            "{{topic}}",
                        )
                    ],
                ),
                panel(
                    "topic-produce-rate",
                    "Produced records / sec (exporter)",
                    "timeseries",
                    "ops",
                    [("sum by (topic) (rate(kafka_topic_partition_current_offset[5m]))", "{{topic}}")],
                ),
            ],
        },
        {
            "title": "Size & health",
            "panels": [
                panel(
                    "topic-size",
                    "Topic log size",
                    "timeseries",
                    "bytes",
                    [("sum by (topic) (kafka_log_log_size)", "{{topic}}")],
                ),
                panel(
                    "topic-partitions",
                    "Partitions per topic",
                    "table",
                    "short",
                    [("kafka_topic_partitions", "{{topic}}")],
                ),
                panel(
                    "topic-under-replicated",
                    "Under-replicated partitions by topic",
                    "timeseries",
                    "short",
                    [("sum by (topic) (kafka_topic_partition_under_replicated_partition)", "{{topic}}")],
                ),
                panel(
                    "topic-end-offsets",
                    "Partition end offsets",
                    "timeseries",
                    "short",
                    [("sum by (topic) (kafka_topic_partition_current_offset)", "{{topic}}")],
                ),
            ],
        },
    ],
}


CONSUMER_LAG: dict[str, Any] = {
    "id": "consumer-lag",
    "title": "Consumer lag",
    "description": "Consumer group lag, membership and consumption rate (kafka-exporter).",
    "tags": ["kafka", "consumers"],
    "builtin": True,
    "variables": [
        {"name": "group", "query": "label_values(kafka_consumergroup_lag, consumergroup)"},
    ],
    "rows": [
        {
            "title": "Lag",
            "panels": [
                panel(
                    "total-lag", "Total lag", "stat", "short", [("sum(kafka_consumergroup_lag)", "total lag")]
                ),
                panel(
                    "lag-by-group",
                    "Lag by consumer group",
                    "timeseries",
                    "short",
                    [("sum by (consumergroup) (kafka_consumergroup_lag)", "{{consumergroup}}")],
                ),
                panel(
                    "lag-by-topic",
                    "Lag by group and topic",
                    "timeseries",
                    "short",
                    [
                        (
                            "sum by (consumergroup, topic) (kafka_consumergroup_lag)",
                            "{{consumergroup}} / {{topic}}",
                        )
                    ],
                ),
                panel(
                    "top-lagging",
                    "Top 10 lagging partitions",
                    "table",
                    "short",
                    [("topk(10, kafka_consumergroup_lag)", "{{consumergroup}} {{topic}}:{{partition}}")],
                ),
            ],
        },
        {
            "title": "Consumption",
            "panels": [
                panel(
                    "group-members",
                    "Members per group",
                    "timeseries",
                    "short",
                    [("sum by (consumergroup) (kafka_consumergroup_members)", "{{consumergroup}}")],
                ),
                panel(
                    "commit-rate",
                    "Committed offset rate",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum by (consumergroup) (rate(kafka_consumergroup_current_offset[5m]))",
                            "{{consumergroup}}",
                        )
                    ],
                ),
                panel(
                    "lag-growth",
                    "Lag growth / sec",
                    "timeseries",
                    "ops",
                    [("sum by (consumergroup) (deriv(kafka_consumergroup_lag[10m]))", "{{consumergroup}}")],
                ),
            ],
        },
    ],
}
