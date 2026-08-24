"""Built-in ecosystem dashboards: Kafka Connect, Flink and the JVM."""

from __future__ import annotations

from typing import Any

from k_shui.integrations.dashboards.panel import JVM_USED, panel

CONNECT: dict[str, Any] = {
    "id": "connect",
    "title": "Kafka Connect",
    "description": "Connector and task state, record rates, rebalances and worker health.",
    "tags": ["connect"],
    "builtin": True,
    "variables": [
        {"name": "connector", "query": "label_values(kafka_connect_connector_status, connector)"},
    ],
    "rows": [
        {
            "title": "Connectors",
            "panels": [
                panel(
                    "connector-count",
                    "Connectors",
                    "stat",
                    "short",
                    [("count(count by (connector) (kafka_connect_connector_status))", "connectors")],
                ),
                panel(
                    "connector-state",
                    "Connector state",
                    "table",
                    "short",
                    [("kafka_connect_connector_status", "{{connector}} {{status}}")],
                ),
                panel(
                    "tasks-running",
                    "Running tasks",
                    "stat",
                    "short",
                    [('sum(kafka_connect_connector_task_status{status="running"})', "running")],
                ),
                panel(
                    "task-errors",
                    "Record errors / sec",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum by (connector) (rate(kafka_connect_task_error_total_record_errors[5m]))",
                            "{{connector}}",
                        )
                    ],
                ),
                panel(
                    "tasks-failed",
                    "Failed tasks",
                    "stat",
                    "short",
                    [
                        (
                            "sum(kafka_connect_worker_connector_failed_task_count) or "
                            'sum(kafka_connect_connector_task_status{status="failed"})',
                            "failed",
                        )
                    ],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "red"}],
                ),
            ],
        },
        {
            "title": "Throughput",
            "panels": [
                panel(
                    "source-record-rate",
                    "Source record poll rate",
                    "timeseries",
                    "ops",
                    [
                        (
                            "sum by (connector) (kafka_connect_source_task_source_record_poll_rate)",
                            "{{connector}}",
                        )
                    ],
                ),
                panel(
                    "sink-record-rate",
                    "Sink record read rate",
                    "timeseries",
                    "ops",
                    [("sum by (connector) (kafka_connect_sink_task_sink_record_read_rate)", "{{connector}}")],
                ),
                panel(
                    "task-batch-size",
                    "Average batch size",
                    "timeseries",
                    "short",
                    [("avg by (connector) (kafka_connect_connector_task_batch_size_avg)", "{{connector}}")],
                ),
                panel(
                    "offset-commit-time",
                    "Offset commit time (ms)",
                    "timeseries",
                    "ms",
                    [
                        (
                            "avg by (connector) (kafka_connect_connector_task_offset_commit_avg_time_ms)",
                            "{{connector}}",
                        )
                    ],
                ),
            ],
        },
        {
            "title": "Workers",
            "panels": [
                panel(
                    "assigned-connectors",
                    "Assigned connectors per worker",
                    "timeseries",
                    "short",
                    [("kafka_connect_coordinator_assigned_connectors", "{{pod}}")],
                ),
                panel(
                    "assigned-tasks",
                    "Assigned tasks per worker",
                    "timeseries",
                    "short",
                    [("kafka_connect_coordinator_assigned_tasks", "{{pod}}")],
                ),
                panel(
                    "rebalance-rate",
                    "Rebalances",
                    "timeseries",
                    "ops",
                    [
                        ("sum(rate(kafka_connect_coordinator_rebalance_total[15m]))", "rebalances"),
                        ("sum(rate(kafka_connect_coordinator_failed_rebalance_total[15m]))", "failed"),
                    ],
                ),
                panel(
                    "rebalance-latency",
                    "Rebalance latency (ms)",
                    "timeseries",
                    "ms",
                    [("avg(kafka_connect_coordinator_rebalance_latency_avg)", "avg latency")],
                ),
            ],
        },
    ],
}


FLINK: dict[str, Any] = {
    "id": "flink",
    "title": "Flink",
    "description": "Job health, checkpoints, restarts and TaskManager resources.",
    "tags": ["flink"],
    "builtin": True,
    "variables": [{"name": "job", "query": "label_values(flink_jobmanager_job_uptime, job_name)"}],
    "rows": [
        {
            "title": "Jobs",
            "panels": [
                panel(
                    "flink-running-jobs",
                    "Running jobs",
                    "stat",
                    "short",
                    [("sum(flink_jobmanager_numRunningJobs)", "running")],
                ),
                panel(
                    "flink-taskmanagers",
                    "Registered TaskManagers",
                    "stat",
                    "short",
                    [("sum(flink_jobmanager_numRegisteredTaskManagers)", "taskmanagers")],
                ),
                panel(
                    "flink-uptime",
                    "Job uptime",
                    "timeseries",
                    "ms",
                    [("flink_jobmanager_job_uptime", "{{job_name}}")],
                ),
                panel(
                    "flink-restarts",
                    "Job restarts",
                    "timeseries",
                    "short",
                    [("flink_jobmanager_job_numRestarts", "{{job_name}}")],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "orange"}],
                ),
                panel(
                    "flink-downtime",
                    "Job downtime",
                    "timeseries",
                    "ms",
                    [("flink_jobmanager_job_downtime", "{{job_name}}")],
                ),
            ],
        },
        {
            "title": "Checkpoints",
            "panels": [
                panel(
                    "flink-ckpt-completed",
                    "Completed checkpoints",
                    "timeseries",
                    "short",
                    [("flink_jobmanager_job_numberOfCompletedCheckpoints", "{{job_name}}")],
                ),
                panel(
                    "flink-ckpt-failed",
                    "Failed checkpoints",
                    "timeseries",
                    "short",
                    [("flink_jobmanager_job_numberOfFailedCheckpoints", "{{job_name}}")],
                    thresholds=[{"value": 0, "color": "green"}, {"value": 1, "color": "red"}],
                ),
                panel(
                    "flink-ckpt-duration",
                    "Last checkpoint duration",
                    "timeseries",
                    "ms",
                    [("flink_jobmanager_job_lastCheckpointDuration", "{{job_name}}")],
                ),
                panel(
                    "flink-ckpt-size",
                    "Last checkpoint size",
                    "timeseries",
                    "bytes",
                    [("flink_jobmanager_job_lastCheckpointSize", "{{job_name}}")],
                ),
            ],
        },
        {
            "title": "TaskManagers",
            "panels": [
                panel(
                    "flink-tm-heap",
                    "TaskManager heap used",
                    "timeseries",
                    "bytes",
                    [("flink_taskmanager_Status_JVM_Memory_Heap_Used", "{{instance}}")],
                ),
                panel(
                    "flink-tm-cpu",
                    "TaskManager CPU load",
                    "timeseries",
                    "percentunit",
                    [("flink_taskmanager_Status_JVM_CPU_Load", "{{instance}}")],
                ),
                panel(
                    "flink-tm-gc",
                    "TaskManager GC time / sec",
                    "timeseries",
                    "ms",
                    [("flink_taskmanager_Status_JVM_GarbageCollector_All_TimeMsPerSecond", "{{instance}}")],
                ),
                panel(
                    "flink-tm-network",
                    "Available network memory segments",
                    "timeseries",
                    "short",
                    [("flink_taskmanager_Status_Network_AvailableMemorySegments", "{{instance}}")],
                ),
            ],
        },
    ],
}


JVM: dict[str, Any] = {
    "id": "jvm",
    "title": "JVM",
    "description": "Heap, garbage collection, threads and class loading across all JVMs.",
    "tags": ["jvm", "runtime"],
    "builtin": True,
    "variables": [{"name": "instance", "query": "label_values(jvm_memory_used_bytes, instance)"}],
    "rows": [
        {
            "title": "Memory",
            "panels": [
                panel("jvm-heap-used", "Heap used", "timeseries", "bytes", [(JVM_USED, "{{instance}}")]),
                panel(
                    "jvm-heap-max",
                    "Heap max",
                    "timeseries",
                    "bytes",
                    [('sum(jvm_memory_max_bytes{area="heap"}) by (instance)', "{{instance}}")],
                ),
                panel(
                    "jvm-nonheap-used",
                    "Non-heap used",
                    "timeseries",
                    "bytes",
                    [('sum(jvm_memory_used_bytes{area="nonheap"}) by (instance)', "{{instance}}")],
                ),
                panel(
                    "jvm-pool-used",
                    "Memory pool used",
                    "timeseries",
                    "bytes",
                    [("sum by (pool) (jvm_memory_pool_used_bytes)", "{{pool}}")],
                ),
            ],
        },
        {
            "title": "Runtime",
            "panels": [
                panel(
                    "jvm-gc-rate",
                    "GC time / sec",
                    "timeseries",
                    "s",
                    [("sum by (instance) (rate(jvm_gc_collection_seconds_sum[5m]))", "{{instance}}")],
                ),
                panel(
                    "jvm-gc-count",
                    "GC collections / sec",
                    "timeseries",
                    "ops",
                    [("sum by (gc) (rate(jvm_gc_collection_seconds_count[5m]))", "{{gc}}")],
                ),
                panel(
                    "jvm-threads",
                    "Live threads",
                    "timeseries",
                    "short",
                    [("jvm_threads_current", "{{instance}}")],
                ),
                panel(
                    "jvm-classes",
                    "Loaded classes",
                    "timeseries",
                    "short",
                    [("jvm_classes_currently_loaded or jvm_classes_loaded", "{{instance}}")],
                ),
                panel(
                    "process-cpu",
                    "Process CPU / sec",
                    "timeseries",
                    "percentunit",
                    [("sum by (instance) (rate(process_cpu_seconds_total[5m]))", "{{instance}}")],
                ),
            ],
        },
    ],
}
