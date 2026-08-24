"""Alert metric catalog: which metrics can be alerted on, per component.

Each entry declares the unit, a human description, the data source used to evaluate it
(``kafka`` admin API, ``prometheus``, ``connect``, ``flink``, ``ksql``) and an optional
PromQL template. ``{target}`` in a template is replaced with the resolved target name.
"""

from __future__ import annotations

from typing import Any

Metric = dict[str, Any]


def _m(
    name: str,
    title: str,
    unit: str,
    source: str,
    description: str,
    *,
    promql: str | None = None,
    boolean: bool = False,
    default_condition: str = "gt",
    default_value: float = 0,
) -> Metric:
    return {
        "name": name,
        "title": title,
        "unit": unit,
        "source": source,
        "description": description,
        "promql": promql,
        "boolean": boolean,
        "defaultCondition": default_condition,
        "defaultValue": default_value,
    }


# PromQL templates (``{target}`` is substituted with the resolved target regex).
BT = "kafka_server_brokertopicmetrics"
Q_BROKER_BYTES_IN = f'sum by (pod) (rate({BT}_bytesin_total{{topic="",pod=~"{{target}}"}}[5m]))'
Q_BROKER_BYTES_OUT = f'sum by (pod) (rate({BT}_bytesout_total{{topic="",pod=~"{{target}}"}}[5m]))'
Q_BROKER_PRODUCE_MS = (
    'avg by (pod) (kafka_network_requestmetrics_totaltimems{request="Produce",pod=~"{target}"})'
)
Q_BROKER_FETCH_MS = (
    'avg by (pod) (kafka_network_requestmetrics_totaltimems{request="FetchConsumer",pod=~"{target}"})'
)
Q_TOPIC_BYTES_IN = f'sum by (topic) (rate({BT}_bytesin_total{{topic=~"{{target}}"}}[5m]))'
Q_TOPIC_BYTES_OUT = f'sum by (topic) (rate({BT}_bytesout_total{{topic=~"{{target}}"}}[5m]))'
Q_TOPIC_MESSAGES_IN = f'sum by (topic) (rate({BT}_messagesin_total{{topic=~"{{target}}"}}[5m]))'
Q_GROUP_LAG = 'sum by (consumergroup) (kafka_consumergroup_lag{consumergroup=~"{target}"})'
Q_GROUP_LAG_MAX = 'max by (consumergroup) (kafka_consumergroup_lag{consumergroup=~"{target}"})'
Q_CLUSTER_BYTES_IN = f'sum(rate({BT}_bytesin_total{{topic=""}}[5m]))'
Q_CLUSTER_BYTES_OUT = f'sum(rate({BT}_bytesout_total{{topic=""}}[5m]))'


CATALOG: dict[str, list[Metric]] = {
    "cluster": [
        _m(
            "underReplicatedPartitions",
            "Under-replicated partitions",
            "count",
            "kafka",
            "Partitions whose ISR is smaller than the replica set.",
            promql="sum(kafka_server_replicamanager_underreplicatedpartitions)",
        ),
        _m(
            "offlinePartitions",
            "Offline partitions",
            "count",
            "kafka",
            "Partitions without an active leader.",
            promql="sum(kafka_controller_kafkacontroller_offlinepartitionscount)",
        ),
        _m(
            "activeControllerCount",
            "Active controllers",
            "count",
            "kafka",
            "Should be exactly 1; 0 or >1 means the controller quorum is unhealthy.",
            promql="sum(kafka_controller_kafkacontroller_activecontrollercount)",
            default_condition="ne",
            default_value=1,
        ),
        _m(
            "zkOrKraftUnavailable",
            "Metadata quorum unavailable",
            "bool",
            "kafka",
            "1 when the KRaft/ZooKeeper metadata layer cannot be reached.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
        _m(
            "brokerDownCount",
            "Brokers down",
            "count",
            "kafka",
            "Configured brokers that are not currently reporting as online.",
        ),
        _m(
            "bytesIn",
            "Bytes in / sec",
            "Bps",
            "prometheus",
            "Cluster-wide inbound throughput.",
            promql=Q_CLUSTER_BYTES_IN,
        ),
        _m(
            "bytesOut",
            "Bytes out / sec",
            "Bps",
            "prometheus",
            "Cluster-wide outbound throughput.",
            promql=Q_CLUSTER_BYTES_OUT,
        ),
    ],
    "broker": [
        _m(
            "bytesIn",
            "Bytes in / sec",
            "Bps",
            "prometheus",
            "Inbound throughput for the broker.",
            promql=Q_BROKER_BYTES_IN,
        ),
        _m(
            "bytesOut",
            "Bytes out / sec",
            "Bps",
            "prometheus",
            "Outbound throughput for the broker.",
            promql=Q_BROKER_BYTES_OUT,
        ),
        _m(
            "produceRequestLatency",
            "Produce request latency",
            "ms",
            "prometheus",
            "Mean total time for Produce requests.",
            promql=Q_BROKER_PRODUCE_MS,
        ),
        _m(
            "fetchRequestLatency",
            "Fetch request latency",
            "ms",
            "prometheus",
            "Mean total time for FetchConsumer requests.",
            promql=Q_BROKER_FETCH_MS,
        ),
        _m(
            "diskUsagePct",
            "Log dir usage",
            "percent",
            "kafka",
            "Percentage of the configured retention size in use.",
            default_value=85,
        ),
        _m(
            "isOffline",
            "Broker offline",
            "bool",
            "kafka",
            "1 when the broker is not in the cluster metadata.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
    ],
    "topic": [
        _m(
            "underReplicated",
            "Under-replicated partitions",
            "count",
            "kafka",
            "Partitions of this topic with an incomplete ISR.",
        ),
        _m(
            "bytesIn",
            "Bytes in / sec",
            "Bps",
            "prometheus",
            "Topic inbound throughput.",
            promql=Q_TOPIC_BYTES_IN,
        ),
        _m(
            "bytesOut",
            "Bytes out / sec",
            "Bps",
            "prometheus",
            "Topic outbound throughput.",
            promql=Q_TOPIC_BYTES_OUT,
        ),
        _m(
            "messagesIn",
            "Messages in / sec",
            "ops",
            "prometheus",
            "Topic message rate.",
            promql=Q_TOPIC_MESSAGES_IN,
        ),
        _m("sizeBytes", "Topic size", "bytes", "kafka", "Total log size across all partitions."),
    ],
    "consumerGroup": [
        _m(
            "lag",
            "Total lag",
            "count",
            "kafka",
            "Sum of the lag across every assigned partition.",
            promql=Q_GROUP_LAG,
            default_value=1000,
        ),
        _m(
            "lagPerPartition",
            "Max partition lag",
            "count",
            "kafka",
            "Largest lag on any single partition.",
            promql=Q_GROUP_LAG_MAX,
            default_value=1000,
        ),
        _m(
            "consumptionDifference",
            "Consumption difference",
            "count",
            "kafka",
            "End offset minus committed offset, summed across partitions.",
        ),
        _m(
            "memberCount",
            "Members",
            "count",
            "kafka",
            "Number of members currently in the group.",
            default_condition="lt",
            default_value=1,
        ),
        _m(
            "isEmpty",
            "Group empty",
            "bool",
            "kafka",
            "1 when the group has no members.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
    ],
    "connector": [
        _m(
            "state",
            "Connector not running",
            "bool",
            "connect",
            "1 when the connector state is anything other than RUNNING.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
        _m("failedTasks", "Failed tasks", "count", "connect", "Tasks in the FAILED state."),
        _m(
            "taskState",
            "Tasks not running",
            "count",
            "connect",
            "Tasks whose state is not RUNNING (includes PAUSED and UNASSIGNED).",
        ),
    ],
    "ksqlQuery": [
        _m(
            "errorRate",
            "Query error rate",
            "ops",
            "ksql",
            "Errors per second reported by the persistent query.",
        ),
        _m(
            "messagesConsumed",
            "Messages consumed",
            "count",
            "ksql",
            "Messages consumed by the query since it started.",
            default_condition="lt",
        ),
        _m(
            "state",
            "Query not running",
            "bool",
            "ksql",
            "1 when the query state is anything other than RUNNING.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
    ],
    "flinkJob": [
        _m(
            "state",
            "Job not running",
            "bool",
            "flink",
            "1 when the job state is anything other than RUNNING.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
        _m("restarts", "Restarts", "count", "flink", "Number of full job restarts."),
        _m(
            "checkpointFailures",
            "Failed checkpoints",
            "count",
            "flink",
            "Checkpoints that failed since the job started.",
        ),
        _m(
            "backpressure",
            "Backpressured subtasks",
            "count",
            "flink",
            "Subtasks reporting a high backpressure level.",
        ),
    ],
    "schemaRegistry": [
        _m(
            "unavailable",
            "Registry unreachable",
            "bool",
            "schemaRegistry",
            "1 when the schema registry does not answer.",
            boolean=True,
            default_condition="eq",
            default_value=1,
        ),
        _m(
            "subjectCount",
            "Subjects",
            "count",
            "schemaRegistry",
            "Number of registered subjects.",
            default_condition="lt",
        ),
    ],
    "custom": [
        _m(
            "promql",
            "PromQL expression",
            "number",
            "prometheus",
            "Evaluate an arbitrary instant PromQL expression; the first sample value is compared.",
        ),
    ],
}

COMPONENTS = list(CATALOG)


def catalog() -> dict[str, list[Metric]]:
    return CATALOG


def find(component: str, metric: str) -> Metric | None:
    return next((m for m in CATALOG.get(component, []) if m["name"] == metric), None)


def as_list() -> list[dict[str, Any]]:
    """Flat catalog for ``GET /alerts/metrics``."""
    return [{"component": component, "metrics": metrics} for component, metrics in CATALOG.items()]
