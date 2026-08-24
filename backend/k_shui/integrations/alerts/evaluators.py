"""Per-component alert evaluators.

An evaluator resolves a trigger's *targets* (an explicit name or a regex over the live
objects) and produces one :class:`Measurement` per target. Every evaluator degrades
gracefully: an unreachable source yields no measurements rather than raising, so one
broken integration never stops the whole evaluation pass.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any

from k_shui.core.registry import ClusterContext
from k_shui.integrations.alerts.metrics_catalog import find
from k_shui.integrations.prometheus import try_prometheus

CLUSTER_TARGET = "*"


@dataclass(slots=True)
class Measurement:
    target: str
    value: float | None
    labels: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


def _matcher(target: dict[str, Any] | None):
    """Build a predicate from ``{name}`` or ``{regex}`` (matches everything when empty)."""
    target = target or {}
    name = target.get("name")
    regex = target.get("regex")
    if regex:
        try:
            compiled = re.compile(regex)
        except re.error:
            return lambda _value: False
        return lambda value: bool(compiled.search(value))
    if name:
        return lambda value: value == name
    return lambda _value: True


def _promql_target(target: dict[str, Any] | None) -> str:
    target = target or {}
    return str(target.get("regex") or target.get("name") or ".*")


async def _prom_scalar(ctx: ClusterContext, expr: str) -> float | None:
    client = try_prometheus(ctx)
    if client is None:
        return None
    try:
        result = await client.query(expr)
    except Exception:
        return None
    for entry in result.get("result", []):
        try:
            return float(entry["value"][1])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    return None


async def _prom_series(ctx: ClusterContext, expr: str, label: str) -> list[Measurement]:
    client = try_prometheus(ctx)
    if client is None:
        return []
    try:
        result = await client.query(expr)
    except Exception:
        return []
    out: list[Measurement] = []
    for entry in result.get("result", []):
        metric = entry.get("metric", {})
        try:
            value = float(entry["value"][1])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        out.append(Measurement(str(metric.get(label, "?")), value, metric))
    return out


def _admin(ctx: ClusterContext) -> Any | None:
    try:
        from k_shui.kafka.admin import KafkaAdmin

        return KafkaAdmin.get(ctx)
    except Exception:
        return None


# ------------------------------------------------------------------------ cluster


async def eval_cluster(ctx: ClusterContext, metric: str, target: dict[str, Any] | None) -> list[Measurement]:
    label = ctx.config.name or ctx.id
    spec = find("cluster", metric)
    admin = _admin(ctx)
    if metric in ("bytesIn", "bytesOut") or (spec and spec["source"] == "prometheus"):
        value = await _prom_scalar(ctx, spec["promql"]) if spec and spec["promql"] else None
        return [Measurement(label, value)]
    if admin is None:
        if spec and spec.get("promql"):
            return [Measurement(label, await _prom_scalar(ctx, spec["promql"]))]
        return []
    try:
        info = await admin.describe_cluster()
    except Exception:
        if metric == "zkOrKraftUnavailable":
            return [Measurement(label, 1.0)]
        return [Measurement(label, None, error="kafka unreachable")]
    if metric == "zkOrKraftUnavailable":
        return [Measurement(label, 0.0)]
    if metric == "brokerDownCount":
        brokers = info.get("brokers", []) or []
        offline = sum(1 for b in brokers if b.get("status") == "offline")
        return [Measurement(label, float(offline))]
    if metric == "activeControllerCount":
        value = await _prom_scalar(ctx, spec["promql"]) if spec and spec["promql"] else None
        if value is None:
            value = 1.0 if info.get("controllerId") is not None else 0.0
        return [Measurement(label, value)]
    if metric in ("underReplicatedPartitions", "offlinePartitions"):
        value = await _prom_scalar(ctx, spec["promql"]) if spec and spec["promql"] else None
        if value is None:
            value = float(info.get(metric, 0) or 0)
        return [Measurement(label, value)]
    return []


# ------------------------------------------------------------------------- broker


async def eval_broker(ctx: ClusterContext, metric: str, target: dict[str, Any] | None) -> list[Measurement]:
    admin = _admin(ctx)
    matches = _matcher(target)
    if metric in ("bytesIn", "bytesOut", "produceRequestLatency", "fetchRequestLatency"):
        spec = find("broker", metric)
        if not spec or not spec["promql"]:
            return []
        expr = spec["promql"].replace("{target}", _promql_target(target))
        return await _prom_series(ctx, expr, "pod")
    if admin is None:
        return []
    try:
        info = await admin.describe_cluster()
    except Exception:
        return []
    out: list[Measurement] = []
    for broker in info.get("brokers", []) or []:
        name = str(broker.get("id"))
        if not (matches(name) or matches(str(broker.get("host", "")))):
            continue
        if metric == "isOffline":
            out.append(Measurement(name, 1.0 if broker.get("status") == "offline" else 0.0, broker))
        elif metric == "diskUsagePct":
            out.append(Measurement(name, float(broker.get("diskUsagePct") or 0.0), broker))
    return out


# -------------------------------------------------------------------------- topic


async def eval_topic(ctx: ClusterContext, metric: str, target: dict[str, Any] | None) -> list[Measurement]:
    spec = find("topic", metric)
    if spec and spec["source"] == "prometheus" and spec["promql"]:
        expr = spec["promql"].replace("{target}", _promql_target(target))
        return await _prom_series(ctx, expr, "topic")
    admin = _admin(ctx)
    if admin is None:
        return []
    matches = _matcher(target)
    try:
        topics = await admin.list_topics(include_internal=False)
    except Exception:
        return []
    out: list[Measurement] = []
    for topic in topics:
        name = str(topic.get("name"))
        if not matches(name):
            continue
        if metric == "underReplicated":
            out.append(Measurement(name, float(topic.get("underReplicatedPartitions", 0) or 0)))
        elif metric == "sizeBytes":
            out.append(Measurement(name, float(topic.get("sizeBytes", 0) or 0)))
    return out


# ------------------------------------------------------------------ consumer group


async def eval_consumer_group(
    ctx: ClusterContext, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    admin = _admin(ctx)
    matches = _matcher(target)
    if admin is None:
        spec = find("consumerGroup", metric)
        if spec and spec["promql"]:
            expr = spec["promql"].replace("{target}", _promql_target(target))
            return await _prom_series(ctx, expr, "consumergroup")
        return []
    try:
        groups = await admin.list_groups()
    except Exception:
        return []
    selected = [g for g in groups if matches(str(g.get("groupId")))]
    if metric == "memberCount":
        return [Measurement(str(g.get("groupId")), float(g.get("memberCount", 0) or 0)) for g in selected]
    if metric == "isEmpty":
        return [
            Measurement(str(g.get("groupId")), 1.0 if str(g.get("state")).upper() == "EMPTY" else 0.0)
            for g in selected
        ]
    offsets = await asyncio.gather(
        *(admin.group_offsets(str(g.get("groupId"))) for g in selected), return_exceptions=True
    )
    out: list[Measurement] = []
    for group, partitions in zip(selected, offsets, strict=False):
        name = str(group.get("groupId"))
        if not isinstance(partitions, list):
            continue
        # `group_offsets` reports committed offsets only; lag needs the end offset of
        # each partition, so resolve the high watermarks the same way the group detail
        # endpoint does. Without this every lag measurement is 0 and lag alerts never fire.
        lags = await _group_lags(admin, partitions)
        if metric == "lag" or metric == "consumptionDifference":
            out.append(Measurement(name, sum(lags), {"partitions": len(lags)}))
        elif metric == "lagPerPartition":
            out.append(Measurement(name, max(lags) if lags else 0.0, {"partitions": len(lags)}))
    return out


async def _group_lags(admin: Any, partitions: list[dict[str, Any]]) -> list[float]:
    """Lag per committed partition = max(endOffset - committedOffset, 0)."""
    if not partitions:
        return []
    try:
        marks = await admin.watermarks([(p["topic"], p["partition"]) for p in partitions])
    except Exception:
        return []
    lags: list[float] = []
    for p in partitions:
        _low, high = marks.get((p["topic"], p["partition"]), (0, 0))
        lags.append(float(max(high - p["offset"], 0)))
    return lags


# ---------------------------------------------------------------------- connector


async def eval_connector(
    ctx: ClusterContext, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    from k_shui.integrations.connect import all_connects

    matches = _matcher(target)
    out: list[Measurement] = []
    for client in all_connects(ctx):
        try:
            connectors = await client.list_connectors()
        except Exception:
            continue
        for connector in connectors:
            name = str(connector.get("name"))
            if not matches(name):
                continue
            labels = {"connect": client.name, "state": connector.get("state")}
            if metric == "state":
                value = 0.0 if connector.get("state") == "RUNNING" else 1.0
            elif metric == "failedTasks":
                value = float(connector.get("failedTasks", 0) or 0)
            elif metric == "taskState":
                tasks = connector.get("tasks", []) or []
                value = float(sum(1 for t in tasks if t.get("state") != "RUNNING"))
            else:
                continue
            out.append(Measurement(f"{client.name}/{name}", value, labels))
    return out


# --------------------------------------------------------------------- flink job


async def eval_flink_job(
    ctx: ClusterContext, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    from k_shui.integrations.flink import all_flink

    matches = _matcher(target)
    out: list[Measurement] = []
    for client in all_flink(ctx):
        try:
            jobs = await client.jobs()
        except Exception:
            continue
        for job in jobs:
            name = str(job.get("name") or job.get("jid"))
            if not matches(name) and not matches(str(job.get("jid"))):
                continue
            labels = {"flink": client.name, "jid": job.get("jid"), "state": job.get("state")}
            if metric == "state":
                out.append(
                    Measurement(
                        f"{client.name}/{name}", 0.0 if job.get("state") == "RUNNING" else 1.0, labels
                    )
                )
                continue
            value = await _flink_job_metric(client, str(job.get("jid")), metric)
            if value is not None:
                out.append(Measurement(f"{client.name}/{name}", value, labels))
    return out


async def _flink_job_metric(client: Any, jid: str, metric: str) -> float | None:
    if metric == "restarts":
        metrics = await _flink_metrics(client, jid, "numRestarts,fullRestarts")
        return metrics.get("numRestarts", metrics.get("fullRestarts"))
    if metric == "checkpointFailures":
        try:
            checkpoints = await client.checkpoints(jid)
        except Exception:
            return None
        return float((checkpoints.get("counts") or {}).get("failed", 0) or 0)
    if metric == "backpressure":
        try:
            detail = await client.job(jid)
        except Exception:
            return None
        count = 0
        for vertex in detail.get("vertices") or []:
            try:
                bp = await client.backpressure(jid, str(vertex.get("id")))
            except Exception:
                continue
            if str(bp.get("backpressureLevel") or bp.get("status")).lower() in ("high", "ok-high"):
                count += 1
            count += sum(
                1 for s in (bp.get("subtasks") or []) if str(s.get("backpressureLevel", "")).lower() == "high"
            )
        return float(count)
    return None


async def _flink_metrics(client: Any, jid: str, get: str) -> dict[str, float]:
    try:
        raw = await client.job_metrics(jid, get)
    except Exception:
        return {}
    out: dict[str, float] = {}
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        try:
            out[str(entry.get("id"))] = float(entry.get("value"))
        except (TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------------- ksqlDB


async def eval_ksql_query(
    ctx: ClusterContext, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    from k_shui.integrations.ksql import all_ksql

    matches = _matcher(target)
    out: list[Measurement] = []
    for client in all_ksql(ctx):
        try:
            queries = await client.queries()
        except Exception:
            continue
        for query in queries:
            qid = str(query.get("id"))
            if not matches(qid):
                continue
            labels = {"ksql": client.name, "state": query.get("state")}
            if metric == "state":
                out.append(
                    Measurement(
                        f"{client.name}/{qid}", 0.0 if query.get("state") == "RUNNING" else 1.0, labels
                    )
                )
            elif metric == "errorRate":
                counts = query.get("statusCount") or {}
                out.append(Measurement(f"{client.name}/{qid}", float(counts.get("ERROR", 0) or 0), labels))
            elif metric == "messagesConsumed":
                out.append(
                    Measurement(f"{client.name}/{qid}", float(query.get("messagesConsumed", 0) or 0), labels)
                )
    return out


# -------------------------------------------------------------- schema registry


async def eval_schema_registry(
    ctx: ClusterContext, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    from k_shui.integrations.schema_registry import get_schema_registry

    try:
        client = get_schema_registry(ctx)
        subjects = await client.list_subject_names()
    except Exception:
        return [Measurement("schemaRegistry", 1.0 if metric == "unavailable" else None)]
    if metric == "unavailable":
        return [Measurement("schemaRegistry", 0.0)]
    if metric == "subjectCount":
        return [Measurement("schemaRegistry", float(len(subjects)))]
    return []


# --------------------------------------------------------------------- custom


async def eval_custom(ctx: ClusterContext, metric: str, target: dict[str, Any] | None) -> list[Measurement]:
    expr = (target or {}).get("expr") or (target or {}).get("name") or ""
    if not expr:
        return []
    client = try_prometheus(ctx)
    if client is None:
        return []
    try:
        result = await client.query(expr)
    except Exception as exc:
        return [Measurement(expr[:80], None, error=str(exc))]
    out = [
        Measurement(
            str(entry.get("metric", {}).get("__name__") or expr[:80]),
            float(entry["value"][1]),
            entry.get("metric", {}),
        )
        for entry in result.get("result", [])
        if entry.get("value")
    ]
    return out or [Measurement(expr[:80], None, error="no data")]


EVALUATORS = {
    "cluster": eval_cluster,
    "broker": eval_broker,
    "topic": eval_topic,
    "consumerGroup": eval_consumer_group,
    "connector": eval_connector,
    "flinkJob": eval_flink_job,
    "ksqlQuery": eval_ksql_query,
    "schemaRegistry": eval_schema_registry,
    "custom": eval_custom,
}


async def evaluate(
    ctx: ClusterContext, component: str, metric: str, target: dict[str, Any] | None
) -> list[Measurement]:
    """Evaluate one trigger's metric, returning one measurement per resolved target."""
    evaluator = EVALUATORS.get(component)
    if evaluator is None:
        return []
    try:
        return await evaluator(ctx, metric, target)
    except Exception as exc:
        return [Measurement((target or {}).get("name") or component, None, error=str(exc))]
