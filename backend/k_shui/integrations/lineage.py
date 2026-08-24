"""Stream lineage: a Marquez (OpenLineage) client plus a derived-edge graph builder."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from k_shui.config import LineageConfig
from k_shui.core.errors import IntegrationNotConfigured
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import HttpClient

COMPONENT = "marquez"


def _q(value: str) -> str:
    """Percent-encode a path segment (Marquez namespaces contain ``kafka://`` slashes)."""
    return quote(str(value), safe="")


class MarquezClient:
    """Async client for the Marquez REST API (``/api/v1``)."""

    def __init__(self, config: LineageConfig) -> None:
        self.config = config
        self.url = (config.url or "").rstrip("/")
        self.http = HttpClient(self.url, config.auth, component=COMPONENT)

    async def aclose(self) -> None:
        await self.http.aclose()

    async def namespaces(self) -> list[dict[str, Any]]:
        data = await self.http.try_json("/namespaces", default={}) or {}
        return list(data.get("namespaces", []))

    async def datasets(self, namespace: str, limit: int = 100) -> list[dict[str, Any]]:
        data = (
            await self.http.try_json(
                f"/namespaces/{_q(namespace)}/datasets", default={}, params={"limit": limit}
            )
            or {}
        )
        return list(data.get("datasets", []))

    async def dataset(self, namespace: str, name: str) -> dict[str, Any] | None:
        return await self.http.try_json(f"/namespaces/{_q(namespace)}/datasets/{_q(name)}", default=None)

    async def jobs(self, namespace: str, limit: int = 100) -> list[dict[str, Any]]:
        data = (
            await self.http.try_json(f"/namespaces/{_q(namespace)}/jobs", default={}, params={"limit": limit})
            or {}
        )
        return list(data.get("jobs", []))

    async def job(self, namespace: str, name: str) -> dict[str, Any] | None:
        return await self.http.try_json(f"/namespaces/{_q(namespace)}/jobs/{_q(name)}", default=None)

    async def runs(self, namespace: str, job: str, limit: int = 20) -> list[dict[str, Any]]:
        data = (
            await self.http.try_json(
                f"/namespaces/{_q(namespace)}/jobs/{_q(job)}/runs", default={}, params={"limit": limit}
            )
            or {}
        )
        return list(data.get("runs", []))

    async def lineage(self, node_id: str, depth: int = 3) -> list[dict[str, Any]]:
        data = (
            await self.http.try_json("/lineage", default={}, params={"nodeId": node_id, "depth": depth}) or {}
        )
        return list(data.get("graph", []))

    async def search(self, q: str, limit: int = 50) -> list[dict[str, Any]]:
        data = await self.http.try_json("/search", default={}, params={"q": q, "limit": limit}) or {}
        return list(data.get("results", []))

    async def ingest(self, event: dict[str, Any]) -> dict[str, Any]:
        resp = await self.http.request("POST", "/lineage", json=event)
        return {"accepted": resp.is_success, "status": resp.status_code}

    async def all_namespaces(self) -> list[str]:
        configured = [n for n in (self.config.namespaces or []) if n]
        if configured:
            return configured
        return [str(n.get("name")) for n in await self.namespaces() if n.get("name")]


def get_marquez(ctx: ClusterContext) -> MarquezClient:
    lineage = ctx.config.lineage
    if lineage is None or lineage.type == "none" or not lineage.url:
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no lineage backend configured")

    def factory(c: ClusterContext) -> MarquezClient:
        assert c.config.lineage is not None
        return MarquezClient(c.config.lineage)

    return ctx.client("marquez", factory)


def try_marquez(ctx: ClusterContext) -> MarquezClient | None:
    try:
        return get_marquez(ctx)
    except IntegrationNotConfigured:
        return None


# ---------------------------------------------------------------------------- ids


def topic_id(cluster: str, name: str) -> str:
    return f"topic:{cluster}:{name}"


def connector_id(cluster: str, connect: str, name: str) -> str:
    return f"connector:{cluster}:{connect}:{name}"


def group_id(cluster: str, group: str) -> str:
    return f"consumerGroup:{cluster}:{group}"


def flink_job_id(cluster: str, flink: str, jid: str) -> str:
    return f"flinkJob:{cluster}:{flink}:{jid}"


def ksql_query_id(cluster: str, server: str, query: str) -> str:
    return f"ksqlQuery:{cluster}:{server}:{query}"


class Graph:
    """Node/edge accumulator that de-duplicates by id and merges metadata."""

    def __init__(self, cluster_id: str) -> None:
        self.cluster_id = cluster_id
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: dict[str, dict[str, Any]] = {}
        self.sources: set[str] = set()

    def node(
        self,
        node_id: str,
        type_: str,
        label: str,
        *,
        namespace: str | None = None,
        status: str | None = None,
        source: str | None = None,
        **meta: Any,
    ) -> str:
        existing = self.nodes.get(node_id)
        if existing is None:
            existing = {
                "id": node_id,
                "type": type_,
                "label": label,
                "namespace": namespace,
                "status": status,
                "clusterId": self.cluster_id,
                "sources": [],
                "meta": {},
            }
            self.nodes[node_id] = existing
        if status and not existing.get("status"):
            existing["status"] = status
        if namespace and not existing.get("namespace"):
            existing["namespace"] = namespace
        if source and source not in existing["sources"]:
            existing["sources"].append(source)
        existing["meta"].update({k: v for k, v in meta.items() if v is not None})
        return node_id

    def edge(self, source: str, target: str, kind: str, source_name: str, **meta: Any) -> None:
        edge_id = f"{source}->{target}:{kind}"
        existing = self.edges.get(edge_id)
        if existing is None:
            existing = {
                "id": edge_id,
                "source": source,
                "target": target,
                "kind": kind,
                "meta": {"sources": []},
            }
            self.edges[edge_id] = existing
        if source_name not in existing["meta"]["sources"]:
            existing["meta"]["sources"].append(source_name)
        existing["meta"].update({k: v for k, v in meta.items() if v is not None})

    def result(self) -> dict[str, Any]:
        return {
            "nodes": list(self.nodes.values()),
            "edges": list(self.edges.values()),
            "sources": sorted(self.sources),
            "clusterId": self.cluster_id,
        }

    def bfs(self, focus: str, depth: int) -> dict[str, Any]:
        """Undirected BFS around ``focus`` limited to ``depth`` hops."""
        if focus not in self.nodes:
            return {
                "nodes": [],
                "edges": [],
                "sources": sorted(self.sources),
                "clusterId": self.cluster_id,
                "focus": focus,
                "found": False,
            }
        adjacency: dict[str, set[str]] = {}
        for edge in self.edges.values():
            adjacency.setdefault(edge["source"], set()).add(edge["target"])
            adjacency.setdefault(edge["target"], set()).add(edge["source"])
        seen = {focus}
        frontier = {focus}
        for _ in range(max(depth, 0)):
            nxt: set[str] = set()
            for node_id in frontier:
                nxt |= adjacency.get(node_id, set()) - seen
            if not nxt:
                break
            seen |= nxt
            frontier = nxt
        return {
            "nodes": [n for nid, n in self.nodes.items() if nid in seen],
            "edges": [e for e in self.edges.values() if e["source"] in seen and e["target"] in seen],
            "sources": sorted(self.sources),
            "clusterId": self.cluster_id,
            "focus": focus,
            "found": True,
        }
