"""Builds the merged stream-lineage graph from Marquez plus derived edges.

Derived sources:

* **marquez**   — OpenLineage datasets/jobs and their input/output edges
* **connect**   — source connector → its topics, topics → sink connector
* **consumers** — topic → consumer group (from the Kafka admin client)
* **ksql**      — DESCRIBE EXTENDED read/write topics per stream/table
* **flink**     — Flink jobs matched to topics by Marquez job name or vertex-name heuristics
"""

from __future__ import annotations

import asyncio
import contextlib
import re
from typing import Any

from k_shui.core.registry import ClusterContext
from k_shui.integrations.lineage import (
    Graph,
    connector_id,
    flink_job_id,
    group_id,
    ksql_query_id,
    topic_id,
    try_marquez,
)

ALL_SOURCES = ("marquez", "connect", "flink", "ksql", "consumers")
_TOPIC_TOKEN = re.compile(r"[A-Za-z0-9._\-]+")


def _is_topic_namespace(namespace: str) -> bool:
    return namespace.startswith("kafka:") or namespace.startswith("kafka://")


async def _add_marquez(graph: Graph, ctx: ClusterContext) -> None:
    client = try_marquez(ctx)
    if client is None:
        return
    namespaces = await client.all_namespaces()
    if not namespaces:
        return
    graph.sources.add("marquez")
    job_lists = await asyncio.gather(*(client.jobs(ns) for ns in namespaces), return_exceptions=True)
    for namespace, jobs in zip(namespaces, job_lists, strict=False):
        if not isinstance(jobs, list):
            continue
        for job in jobs:
            name = job.get("name")
            if not name:
                continue
            node = graph.node(
                f"job:{namespace}:{name}",
                "job",
                str(name),
                namespace=namespace,
                status=(job.get("latestRun") or {}).get("state"),
                source="marquez",
                jobType=job.get("type"),
                description=job.get("description"),
            )
            for dataset in job.get("inputs") or []:
                dataset_node = _dataset_node(graph, ctx, dataset)
                graph.edge(dataset_node, node, "consumes", "marquez")
            for dataset in job.get("outputs") or []:
                dataset_node = _dataset_node(graph, ctx, dataset)
                graph.edge(node, dataset_node, "produces", "marquez")

    dataset_lists = await asyncio.gather(*(client.datasets(ns) for ns in namespaces), return_exceptions=True)
    for namespace, datasets in zip(namespaces, dataset_lists, strict=False):
        if not isinstance(datasets, list):
            continue
        for dataset in datasets:
            _dataset_node(graph, ctx, {"namespace": namespace, "name": dataset.get("name")})


def _dataset_node(graph: Graph, ctx: ClusterContext, dataset: dict[str, Any]) -> str:
    namespace = str(dataset.get("namespace") or "")
    name = str(dataset.get("name") or "")
    if _is_topic_namespace(namespace):
        return graph.node(topic_id(ctx.id, name), "topic", name, namespace=namespace, source="marquez")
    return graph.node(f"dataset:{namespace}:{name}", "dataset", name, namespace=namespace, source="marquez")


async def _add_connect(graph: Graph, ctx: ClusterContext) -> None:
    from k_shui.integrations.connect import all_connects

    clients = all_connects(ctx)
    if not clients:
        return
    results = await asyncio.gather(*(c.list_connectors() for c in clients), return_exceptions=True)
    for client, connectors in zip(clients, results, strict=False):
        if not isinstance(connectors, list):
            continue
        graph.sources.add("connect")
        for connector in connectors:
            name = connector.get("name")
            node = graph.node(
                connector_id(ctx.id, client.name, str(name)),
                "connector",
                str(name),
                namespace=client.name,
                status=connector.get("state"),
                source="connect",
                connectorType=connector.get("type"),
                connectorClass=connector.get("connectorClass"),
                connectCluster=client.name,
                failedTasks=connector.get("failedTasks"),
            )
            for topic in connector.get("topics") or []:
                if topic.startswith("~"):  # unresolved regex pattern
                    continue
                topic_node = graph.node(topic_id(ctx.id, topic), "topic", topic, source="connect")
                if connector.get("type") == "sink":
                    graph.edge(topic_node, node, "consumes", "connect")
                else:
                    graph.edge(node, topic_node, "produces", "connect")


async def _add_consumers(graph: Graph, ctx: ClusterContext) -> None:
    try:
        from k_shui.kafka.admin import KafkaAdmin
    except Exception:
        return
    try:
        admin = KafkaAdmin.get(ctx)
        groups = await admin.list_groups()
    except Exception:
        return
    graph.sources.add("consumers")
    ids = [g.get("groupId") for g in groups if g.get("groupId")]
    offsets = await asyncio.gather(*(admin.group_offsets(str(g)) for g in ids), return_exceptions=True)
    for group, partitions in zip(groups, offsets, strict=False):
        name = str(group.get("groupId"))
        node = graph.node(
            group_id(ctx.id, name),
            "consumerGroup",
            name,
            status=group.get("state"),
            source="consumers",
            members=group.get("memberCount"),
            groupType=group.get("groupType"),
        )
        topics = set()
        if isinstance(partitions, list):
            topics = {str(p.get("topic")) for p in partitions if p.get("topic")}
        for topic in sorted(topics):
            topic_node = graph.node(topic_id(ctx.id, topic), "topic", topic, source="consumers")
            graph.edge(topic_node, node, "consumes", "consumers")


async def _add_ksql(graph: Graph, ctx: ClusterContext) -> None:
    from k_shui.integrations.ksql import all_ksql

    clients = all_ksql(ctx)
    if not clients:
        return
    for client in clients:
        try:
            streams, tables, queries = await asyncio.gather(
                client.streams(), client.tables(), client.queries()
            )
        except Exception:
            continue
        graph.sources.add("ksql")
        for source in list(streams) + list(tables):
            name = str(source.get("name") or "")
            topic = source.get("topic")
            node = graph.node(
                ksql_query_id(ctx.id, client.name, name),
                "ksqlQuery",
                name,
                namespace=client.name,
                source="ksql",
                sourceType=source.get("type"),
            )
            if topic:
                topic_node = graph.node(topic_id(ctx.id, str(topic)), "topic", str(topic), source="ksql")
                graph.edge(node, topic_node, "produces", "ksql")
        for query in queries:
            qid = str(query.get("id") or "")
            node = graph.node(
                ksql_query_id(ctx.id, client.name, qid),
                "ksqlQuery",
                qid,
                namespace=client.name,
                status=query.get("state"),
                source="ksql",
                queryString=query.get("queryString"),
            )
            for topic in query.get("sinkKafkaTopics") or query.get("sinks") or []:
                topic_node = graph.node(topic_id(ctx.id, str(topic)), "topic", str(topic), source="ksql")
                graph.edge(node, topic_node, "transforms", "ksql")


async def _add_flink(graph: Graph, ctx: ClusterContext) -> None:
    from k_shui.integrations.flink import all_flink

    clients = all_flink(ctx)
    if not clients:
        return
    known_topics = {n["label"] for n in graph.nodes.values() if n["type"] == "topic"}
    for client in clients:
        try:
            jobs = await client.jobs()
        except Exception:
            continue
        graph.sources.add("flink")
        for job in jobs:
            jid = str(job.get("jid") or "")
            name = str(job.get("name") or jid)
            node = graph.node(
                flink_job_id(ctx.id, client.name, jid),
                "flinkJob",
                name,
                namespace=client.name,
                status=job.get("state"),
                source="flink",
                jid=jid,
                flinkCluster=client.name,
            )
            # 1) Marquez already knows this job by name → reuse its dataset edges.
            marquez_node = next(
                (n for n in graph.nodes.values() if n["type"] == "job" and n["label"] == name),
                None,
            )
            if marquez_node is not None:
                for edge in list(graph.edges.values()):
                    if edge["source"] == marquez_node["id"]:
                        graph.edge(node, edge["target"], "produces", "flink")
                    elif edge["target"] == marquez_node["id"]:
                        graph.edge(edge["source"], node, "consumes", "flink")
                continue
            # 2) Otherwise fall back to vertex-name heuristics.
            try:
                detail = await client.job(jid)
            except Exception:
                continue
            for vertex in detail.get("vertices") or []:
                vertex_name = str(vertex.get("name") or "")
                for token in set(_TOPIC_TOKEN.findall(vertex_name)) & known_topics:
                    topic_node = graph.node(topic_id(ctx.id, token), "topic", token, source="flink")
                    lowered = vertex_name.lower()
                    if "sink" in lowered or "writer" in lowered or "committer" in lowered:
                        graph.edge(node, topic_node, "produces", "flink")
                    else:
                        graph.edge(topic_node, node, "consumes", "flink")


BUILDERS = {
    "marquez": _add_marquez,
    "connect": _add_connect,
    "consumers": _add_consumers,
    "ksql": _add_ksql,
}


async def build(ctx: ClusterContext, sources: list[str] | None = None) -> Graph:
    """Build the merged graph; unavailable sources are skipped silently."""
    wanted = [s for s in (sources or ALL_SOURCES) if s in ALL_SOURCES]
    graph = Graph(ctx.id)
    await asyncio.gather(*(BUILDERS[s](graph, ctx) for s in wanted if s in BUILDERS), return_exceptions=True)
    if "flink" in wanted:  # needs topics discovered by the other sources first
        with contextlib.suppress(Exception):
            await _add_flink(graph, ctx)
    return graph
