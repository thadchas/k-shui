"""Built-in cluster-level dashboards: overall health/throughput and the KRaft quorum."""

from __future__ import annotations

from typing import Any

from k_shui.integrations.dashboards.panel import BROKER_AGG, panel

CLUSTER_OVERVIEW: dict[str, Any] = {
    "id": "cluster-overview",
    "title": "Cluster overview",
    "description": "Throughput, controller health and partition health for the whole cluster.",
    "tags": ["kafka", "overview"],
    "builtin": True,
    "variables": [],
    "rows": [
        {
            "title": "Health",
            "panels": [
                panel(
                    "brokers-online",
                    "Brokers online",
                    "stat",
                    "short",
                    [
                        (
                            "sum(kafka_brokers) or count(count by (instance) "
                            "(kafka_server_replicamanager_leadercount))",
                            "brokers",
                        )
                    ],
                ),
                panel(
                    "active-controller",
                    "Active controllers",
                    "stat",
                    "short",
                    [("sum(kafka_controller_kafkacontroller_activecontrollercount)", "controllers")],
                    thresholds=[{"value": 1, "color": "green"}, {"value": 2, "color": "red"}],
                ),
                panel(
                    "under-replicated",
                    "Under-replicated partitions",
                    "stat",
                    "short",
                    [("sum(kafka_server_replicamanager_underreplicatedpartitions)", "under-replicated")],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "red"}],
                ),
                panel(
                    "offline-partitions",
                    "Offline partitions",
                    "stat",
                    "short",
                    [("sum(kafka_controller_kafkacontroller_offlinepartitionscount)", "offline")],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "red"}],
                ),
                panel(
                    "topic-count",
                    "Topics",
                    "stat",
                    "short",
                    [("max(kafka_controller_kafkacontroller_globaltopiccount)", "topics")],
                ),
                panel(
                    "partition-count",
                    "Partitions",
                    "stat",
                    "short",
                    [("max(kafka_controller_kafkacontroller_globalpartitioncount)", "partitions")],
                ),
            ],
        },
        {
            "title": "Throughput",
            "panels": [
                panel(
                    "bytes-in",
                    "Bytes in / sec",
                    "timeseries",
                    "Bps",
                    [
                        (
                            f"sum(rate(kafka_server_brokertopicmetrics_bytesin_total{BROKER_AGG}[5m]))",
                            "bytes in",
                        )
                    ],
                ),
                panel(
                    "bytes-out",
                    "Bytes out / sec",
                    "timeseries",
                    "Bps",
                    [
                        (
                            f"sum(rate(kafka_server_brokertopicmetrics_bytesout_total{BROKER_AGG}[5m]))",
                            "bytes out",
                        )
                    ],
                ),
                panel(
                    "messages-in",
                    "Messages in / sec",
                    "timeseries",
                    "ops",
                    [
                        (
                            f"sum(rate(kafka_server_brokertopicmetrics_messagesin_total{BROKER_AGG}[5m]))",
                            "messages in",
                        )
                    ],
                ),
                panel(
                    "request-rate",
                    "Requests / sec by type",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum by (request) (rate(kafka_network_requestmetrics_requests_total[5m]))",
                            "{{request}}",
                        )
                    ],
                ),
            ],
        },
        {
            "title": "Replication",
            "panels": [
                panel(
                    "isr-churn",
                    "ISR shrink / expand rate",
                    "timeseries",
                    "ops",
                    [
                        ("sum(rate(kafka_server_replicamanager_isrshrinks_total[5m]))", "shrinks"),
                        ("sum(rate(kafka_server_replicamanager_isrexpands_total[5m]))", "expands"),
                    ],
                ),
                panel(
                    "under-min-isr",
                    "Partitions under min ISR",
                    "timeseries",
                    "short",
                    [("sum(kafka_server_replicamanager_underminisrpartitioncount)", "under min ISR")],
                ),
                panel(
                    "unclean-elections",
                    "Unclean leader elections",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum(rate(kafka_controller_controllerstats_uncleanleaderelections_total[15m]))",
                            "unclean elections",
                        )
                    ],
                ),
            ],
        },
    ],
}


KRAFT: dict[str, Any] = {
    "id": "kraft",
    "title": "KRaft",
    "description": "Metadata quorum health: leader, epoch, high watermark and metadata lag.",
    "tags": ["kafka", "kraft", "controller"],
    "builtin": True,
    "variables": [],
    "rows": [
        {
            "title": "Quorum",
            "panels": [
                panel(
                    "kraft-voters",
                    "Voters",
                    "stat",
                    "short",
                    [("max(kafka_server_raftmetrics_number_of_voters)", "voters")],
                ),
                panel(
                    "kraft-observers",
                    "Observers",
                    "stat",
                    "short",
                    [("max(kafka_server_raftmetrics_number_of_observers)", "observers")],
                ),
                panel(
                    "kraft-leader",
                    "Current leader id",
                    "stat",
                    "short",
                    [("max(kafka_server_raftmetrics_current_leader)", "leader")],
                ),
                panel(
                    "kraft-epoch",
                    "Current epoch",
                    "stat",
                    "short",
                    [("max(kafka_server_raftmetrics_current_epoch)", "epoch")],
                ),
                panel(
                    "kraft-unknown-voters",
                    "Unknown voter connections",
                    "stat",
                    "short",
                    [("sum(kafka_server_raftmetrics_number_unknown_voter_connections)", "unknown")],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "red"}],
                ),
            ],
        },
        {
            "title": "Metadata log",
            "panels": [
                panel(
                    "kraft-hw",
                    "High watermark",
                    "timeseries",
                    "short",
                    [("max(kafka_server_raftmetrics_high_watermark)", "high watermark")],
                ),
                panel(
                    "kraft-leo",
                    "Log end offset",
                    "timeseries",
                    "short",
                    [("max by (pod) (kafka_server_raftmetrics_log_end_offset)", "{{pod}}")],
                ),
                panel(
                    "kraft-apply-lag",
                    "Metadata apply lag (ms)",
                    "timeseries",
                    "ms",
                    [
                        (
                            "max by (pod) (kafka_server_brokermetadatametrics_last_applied_record_lag_ms)",
                            "{{pod}}",
                        ),
                        ("max(kafka_controller_kafkacontroller_lastappliedrecordlagms)", "controller"),
                    ],
                ),
                panel(
                    "kraft-commit-latency",
                    "Commit latency (ms)",
                    "timeseries",
                    "ms",
                    [("avg(kafka_server_raftmetrics_commit_latency_avg)", "avg commit latency")],
                ),
                panel(
                    "kraft-errors",
                    "Metadata error count",
                    "timeseries",
                    "short",
                    [
                        (
                            "sum(kafka_server_brokermetadatametrics_metadata_apply_error_count)",
                            "apply errors",
                        ),
                        ("sum(kafka_controller_kafkacontroller_metadataerrorcount)", "controller errors"),
                    ],
                ),
            ],
        },
    ],
}
