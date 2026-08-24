"""Prometheus HTTP API client + the query layer behind the metrics dashboards."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from k_shui.config import PrometheusConfig
from k_shui.core.errors import IntegrationNotConfigured
from k_shui.core.registry import ClusterContext
from k_shui.integrations.http import HttpClient
from k_shui.integrations.promql import inject_labels

COMPONENT = "prometheus"

RANGE_SECONDS = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "3h": 10800,
    "6h": 21600,
    "12h": 43200,
    "24h": 86400,
    "1d": 86400,
    "2d": 172800,
    "7d": 604800,
    "30d": 2592000,
}
_DURATION_RE = re.compile(r"^(\d+)(s|m|h|d|w)$")
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def parse_range(value: str | None, default: int = 3600) -> int:
    """``1h`` / ``24h`` / ``7d`` → seconds."""
    if not value:
        return default
    if value in RANGE_SECONDS:
        return RANGE_SECONDS[value]
    match = _DURATION_RE.match(value.strip())
    if match:
        return int(match.group(1)) * _UNIT_SECONDS[match.group(2)]
    return default


def auto_step(seconds: int, max_points: int = 400) -> str:
    """Pick a step that keeps a range query under ``max_points`` samples."""
    raw = max(15, seconds // max_points)
    for candidate in (15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400):
        if raw <= candidate:
            return f"{candidate}s"
    return "86400s"


def _series_name(metric: dict[str, Any], legend: str | None) -> str:
    if legend:

        def repl(match: re.Match[str]) -> str:
            return str(metric.get(match.group(1), ""))

        rendered = re.sub(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", repl, legend).strip()
        if rendered:
            return rendered
    name = metric.get("__name__", "")
    labels = {k: v for k, v in metric.items() if k != "__name__"}
    if not labels:
        return name or "value"
    inner = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
    return f"{name}{{{inner}}}" if name else f"{{{inner}}}"


def to_series(result: list[dict[str, Any]], legend: str | None = None) -> list[dict[str, Any]]:
    """Prometheus ``matrix``/``vector`` result → the contract's ``{series:[…]}`` shape."""
    series: list[dict[str, Any]] = []
    for entry in result or []:
        metric = entry.get("metric", {}) or {}
        raw = entry.get("values") or ([entry["value"]] if "value" in entry else [])
        points: list[list[float | None]] = []
        for sample in raw:
            try:
                ts, value = sample[0], sample[1]
                points.append([float(ts) * 1000.0, None if value in ("NaN", None) else float(value)])
            except (TypeError, ValueError, IndexError):
                continue
        series.append({"name": _series_name(metric, legend), "labels": metric, "points": points})
    return series


class PrometheusClient:
    """Async client for the Prometheus HTTP API with per-cluster label injection."""

    def __init__(self, config: PrometheusConfig) -> None:
        self.config = config
        self.url = config.url.rstrip("/")
        self.labels = dict(config.labels or {})
        self.http = HttpClient(self.url, config.auth, component=COMPONENT)

    async def aclose(self) -> None:
        await self.http.aclose()

    def expand(self, expr: str, variables: dict[str, str] | None = None) -> str:
        """Substitute ``$var``/``[[var]]`` placeholders, then inject the cluster labels."""
        rendered = expr
        for key, value in (variables or {}).items():
            rendered = rendered.replace(f"$__{key}", value).replace(f"${key}", value)
            rendered = rendered.replace(f"[[{key}]]", value)
        rendered = rendered.replace("$__rate_interval", "5m").replace("$__interval", "1m")
        return inject_labels(rendered, self.labels)

    async def _api(self, path: str, params: dict[str, Any]) -> Any:
        data = await self.http.get_json(f"/api/v1/{path}", params=params)
        if isinstance(data, dict) and data.get("status") == "error":
            from k_shui.core.errors import UpstreamError

            raise UpstreamError(
                f"prometheus: {data.get('error', 'query failed')}",
                component=COMPONENT,
                errorType=data.get("errorType"),
            )
        return (data or {}).get("data", {})

    async def query(
        self, expr: str, at: float | None = None, variables: dict[str, str] | None = None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"query": self.expand(expr, variables)}
        if at:
            params["time"] = at
        data = await self._api("query", params)
        return {
            "query": params["query"],
            "resultType": data.get("resultType"),
            "result": data.get("result", []),
        }

    async def query_range(
        self,
        expr: str,
        start: float,
        end: float,
        step: str,
        variables: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        params = {"query": self.expand(expr, variables), "start": start, "end": end, "step": step}
        data = await self._api("query_range", params)
        return {
            "query": params["query"],
            "resultType": data.get("resultType"),
            "result": data.get("result", []),
        }

    async def series_for(
        self,
        expr: str,
        seconds: int,
        step: str | None = None,
        legend: str | None = None,
        variables: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        end = time.time()
        result = await self.query_range(expr, end - seconds, end, step or auto_step(seconds), variables)
        return to_series(result["result"], legend)

    async def label_values(self, label: str, match: str | None = None) -> list[str]:
        params: dict[str, Any] = {}
        if match:
            params["match[]"] = match
        data = await self._api(f"label/{label}/values", params)
        return [str(v) for v in (data or [])]

    async def metadata(self) -> dict[str, Any]:
        data = await self.http.try_json("/api/v1/metadata", default={}) or {}
        return data.get("data", {}) if isinstance(data, dict) else {}

    async def build_info(self) -> dict[str, Any]:
        data = await self.http.try_json("/api/v1/status/buildinfo", default={}) or {}
        return data.get("data", {}) if isinstance(data, dict) else {}

    async def targets(self) -> list[dict[str, Any]]:
        data = await self.http.try_json("/api/v1/targets", default={}, params={"state": "any"}) or {}
        active = (data.get("data") or {}).get("activeTargets", []) if isinstance(data, dict) else []
        return [
            {
                "job": (t.get("labels") or {}).get("job"),
                "instance": (t.get("labels") or {}).get("instance"),
                "health": t.get("health"),
                "lastScrape": t.get("lastScrape"),
                "lastError": t.get("lastError") or None,
                "scrapeUrl": t.get("scrapeUrl"),
            }
            for t in active
        ]

    async def status(self) -> dict[str, Any]:
        build, targets = await asyncio.gather(self.build_info(), self.targets())
        return {
            "configured": True,
            "url": self.url,
            "reachable": bool(build) or bool(targets),
            "labels": self.labels,
            "buildInfo": build,
            "targets": targets,
        }

    async def catalog(self, search: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        names, meta = await asyncio.gather(
            self.label_values("__name__"), self.metadata(), return_exceptions=True
        )
        name_list = names if isinstance(names, list) else []
        meta_map = meta if isinstance(meta, dict) else {}
        if search:
            needle = search.lower()
            name_list = [n for n in name_list if needle in n.lower()]
        rows: list[dict[str, Any]] = []
        for name in sorted(name_list)[:limit]:
            entries = meta_map.get(name) or []
            first = entries[0] if isinstance(entries, list) and entries else {}
            rows.append(
                {
                    "name": name,
                    "type": first.get("type", "unknown"),
                    "help": first.get("help", ""),
                    "unit": first.get("unit", ""),
                }
            )
        return rows


def get_prometheus(ctx: ClusterContext) -> PrometheusClient:
    if ctx.config.prometheus is None:
        raise IntegrationNotConfigured(f"cluster '{ctx.id}' has no prometheus configured")

    def factory(c: ClusterContext) -> PrometheusClient:
        assert c.config.prometheus is not None
        return PrometheusClient(c.config.prometheus)

    return ctx.client("prometheus", factory)


def try_prometheus(ctx: ClusterContext) -> PrometheusClient | None:
    try:
        return get_prometheus(ctx)
    except IntegrationNotConfigured:
        return None


OVERVIEW_QUERIES: dict[str, str] = {
    "bytesIn": 'sum(rate(kafka_server_brokertopicmetrics_bytesin_total{topic=""}[5m]))',
    "bytesOut": 'sum(rate(kafka_server_brokertopicmetrics_bytesout_total{topic=""}[5m]))',
    "messagesIn": 'sum(rate(kafka_server_brokertopicmetrics_messagesin_total{topic=""}[5m]))',
    "requestRate": "sum(rate(kafka_network_requestmetrics_requests_total[5m]))",
    "activeControllers": "sum(kafka_controller_kafkacontroller_activecontrollercount)",
    "underReplicated": "sum(kafka_server_replicamanager_underreplicatedpartitions)",
    "offlinePartitions": "sum(kafka_controller_kafkacontroller_offlinepartitionscount)",
}


def _window(range_: Any) -> tuple[float, float, str]:
    """Normalise ``range_`` (a ``"1h"`` style string or a ``core.deps.TimeRange``)."""
    start = getattr(range_, "start", None)
    end = getattr(range_, "end", None)
    if start is not None and end is not None:
        step = getattr(range_, "step", None)
        seconds = max(int(end - start), 1)
        return float(start), float(end), (f"{int(step)}s" if step else auto_step(seconds))
    seconds = parse_range(range_ if isinstance(range_, str) else None)
    now = time.time()
    return now - seconds, now, auto_step(seconds)


async def get_overview_series(ctx: ClusterContext, range_: Any = "1h") -> list[dict[str, Any]] | None:
    """Cluster-overview series for ``GET /clusters/{c}/overview/metrics``.

    Returns the contract's ``[{name, labels, points}]`` list, or ``None`` when the cluster
    has no Prometheus configured so the caller can fall back to sampled metrics.
    ``range_`` accepts either a ``"1h"``-style string or a ``k_shui.core.deps.TimeRange``.
    """
    client = try_prometheus(ctx)
    if client is None:
        return None
    start, end, step = _window(range_)
    results = await asyncio.gather(
        *(client.query_range(expr, start, end, step) for expr in OVERVIEW_QUERIES.values()),
        return_exceptions=True,
    )
    series: list[dict[str, Any]] = []
    for name, result in zip(OVERVIEW_QUERIES, results, strict=False):
        points: list[list[float | None]] = []
        if isinstance(result, dict):
            rendered = to_series(result.get("result", []))
            points = rendered[0]["points"] if rendered else []
        series.append({"name": name, "labels": {}, "points": points})
    return series


CONNECT_QUERIES = {
    "connectorTasksRunning": 'sum(kafka_connect_connector_task_status{status="running"})',
    "connectorTasksFailed": "sum(kafka_connect_worker_connector_failed_task_count)",
    "sourceRecordRate": "sum(kafka_connect_source_task_source_record_poll_rate)",
    "sinkRecordRate": "sum(kafka_connect_sink_task_sink_record_read_rate)",
    "rebalanceLatency": "avg(kafka_connect_coordinator_rebalance_latency_avg)",
}


async def connect_series(
    ctx: ClusterContext, connect_name: str, range_: str = "1h", step: str | None = None
) -> dict[str, Any]:
    """Prometheus series for one Connect cluster (empty when Prometheus is absent)."""
    client = try_prometheus(ctx)
    if client is None:
        return {"configured": False, "series": []}
    seconds = parse_range(range_)
    chosen = step or auto_step(seconds)
    results = await asyncio.gather(
        *(client.series_for(expr, seconds, chosen, legend=name) for name, expr in CONNECT_QUERIES.items()),
        return_exceptions=True,
    )
    series: list[dict[str, Any]] = []
    for name, result in zip(CONNECT_QUERIES, results, strict=False):
        if isinstance(result, list):
            for entry in result:
                entry["name"] = name
                series.append(entry)
    return {"configured": True, "connect": connect_name, "range": range_, "step": chosen, "series": series}
