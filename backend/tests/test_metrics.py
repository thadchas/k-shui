"""Prometheus proxy, PromQL label injection, built-in + user dashboards."""

from __future__ import annotations

import httpx
import pytest
import respx

from k_shui.integrations.promql import inject_labels
from tests.conftest_integrations import PROM_URL, base, build_app, build_settings

pytest_plugins = ["tests.conftest_integrations"]

M = base("/metrics")


def matrix(name: str, labels: dict, points: list[tuple[float, str]]) -> dict:
    return {"metric": {"__name__": name, **labels}, "values": [[t, v] for t, v in points]}


@pytest.fixture
def prom_mock():
    with respx.mock(base_url=PROM_URL, assert_all_called=False) as mock:
        mock.get("/api/v1/query").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "resultType": "vector",
                        "result": [
                            {"metric": {"__name__": "up", "job": "kafka"}, "value": [1700000000, "1"]}
                        ],
                    },
                },
            )
        )
        mock.get("/api/v1/query_range", name="query_range").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "resultType": "matrix",
                        "result": [
                            matrix("kafka_brokers", {"pod": "b0"}, [(1700000000, "3"), (1700000060, "3")])
                        ],
                    },
                },
            )
        )
        mock.get("/api/v1/status/buildinfo").mock(
            return_value=httpx.Response(200, json={"status": "success", "data": {"version": "3.14.0"}})
        )
        mock.get("/api/v1/targets").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "activeTargets": [
                            {
                                "labels": {"job": "kafka", "instance": "b0:9404"},
                                "health": "up",
                                "lastScrape": "2026-01-01T00:00:00Z",
                                "lastError": "",
                                "scrapeUrl": "http://b0:9404/metrics",
                            }
                        ]
                    },
                },
            )
        )
        mock.get("/api/v1/label/__name__/values").mock(
            return_value=httpx.Response(
                200, json={"status": "success", "data": ["kafka_brokers", "kafka_topic_partitions"]}
            )
        )
        mock.get("/api/v1/metadata").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {"kafka_brokers": [{"type": "gauge", "help": "Number of brokers", "unit": ""}]},
                },
            )
        )
        yield mock


# ------------------------------------------------------------------ label injection


@pytest.mark.parametrize(
    ("expr", "expected"),
    [
        ("up", 'up{cluster="c1"}'),
        ("rate(m[5m])", 'rate(m{cluster="c1"}[5m])'),
        ('sum by (topic) (rate(m{topic!=""}[5m]))', 'sum by (topic) (rate(m{topic!="",cluster="c1"}[5m]))'),
        ("a offset 5m", 'a{cluster="c1"} offset 5m'),
        ("kafka_brokers == 0", 'kafka_brokers{cluster="c1"} == 0'),
        ('{__name__=~"k.*"}', '{__name__=~"k.*",cluster="c1"}'),
        ("max_over_time(x[1h:5m])", 'max_over_time(x{cluster="c1"}[1h:5m])'),
        (
            "sum without (instance) (a) / count(b)",
            'sum without (instance) (a{cluster="c1"}) / count(b{cluster="c1"})',
        ),
        (
            'label_replace(up, "x", "$1", "job", "(.*)")',
            'label_replace(up{cluster="c1"}, "x", "$1", "job", "(.*)")',
        ),
        (
            "histogram_quantile(0.9, sum by (le) (rate(h_bucket[5m])))",
            'histogram_quantile(0.9, sum by (le) (rate(h_bucket{cluster="c1"}[5m])))',
        ),
    ],
)
def test_inject_labels(expr, expected):
    assert inject_labels(expr, {"cluster": "c1"}) == expected


def test_inject_labels_noop_without_labels():
    assert inject_labels("up", {}) == "up"


async def test_query_injects_configured_labels(prom_mock):
    from httpx import ASGITransport, AsyncClient

    settings = build_settings()
    settings.clusters[0].prometheus.labels = {"strimzi_io_cluster": "lakestream"}
    app = build_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://itest") as client:
        body = (await client.get(M + "/query", params={"query": "sum(kafka_brokers)"})).json()
    assert body["query"] == 'sum(kafka_brokers{strimzi_io_cluster="lakestream"})'
    await app.state.registry.aclose()


# ------------------------------------------------------------------------ proxy


async def test_status(api, prom_mock):
    body = (await api.get(M + "/status")).json()
    assert body["configured"] is True
    assert body["reachable"] is True
    assert body["buildInfo"]["version"] == "3.14.0"
    assert body["targets"][0] == {
        "job": "kafka",
        "instance": "b0:9404",
        "health": "up",
        "lastScrape": "2026-01-01T00:00:00Z",
        "lastError": None,
        "scrapeUrl": "http://b0:9404/metrics",
    }


async def test_status_when_not_configured():
    from httpx import ASGITransport, AsyncClient

    settings = build_settings()
    settings.clusters[0].prometheus = None
    app = build_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://itest") as client:
        body = (await client.get(M + "/status")).json()
        assert body == {
            "configured": False,
            "url": None,
            "reachable": False,
            "labels": {},
            "buildInfo": {},
            "targets": [],
        }
        assert (await client.get(M + "/query", params={"query": "up"})).status_code == 404
    await app.state.registry.aclose()


async def test_query_range_defaults_to_range_window(api, prom_mock):
    route = prom_mock["query_range"]
    resp = await api.get(M + "/query_range", params={"query": "kafka_brokers", "range": "6h"})
    assert resp.status_code == 200
    assert resp.json()["resultType"] == "matrix"
    params = dict(route.calls.last.request.url.params)
    assert float(params["end"]) - float(params["start"]) == pytest.approx(6 * 3600, abs=2)
    assert params["step"] == "60s"


async def test_query_range_rejects_inverted_window(api, prom_mock):
    resp = await api.get(M + "/query_range", params={"query": "up", "start": 200, "end": 100, "step": "15s"})
    assert resp.status_code == 400


async def test_series_shape(api, prom_mock):
    body = (await api.get(M + "/series", params={"query": "kafka_brokers", "legend": "{{pod}}"})).json()
    assert body["series"][0]["name"] == "b0"
    assert body["series"][0]["points"][0] == [1700000000000.0, 3.0]


async def test_catalog(api, prom_mock):
    rows = (await api.get(M + "/catalog", params={"search": "brokers"})).json()
    assert rows == [{"name": "kafka_brokers", "type": "gauge", "help": "Number of brokers", "unit": ""}]


async def test_prometheus_error_becomes_upstream_problem(api, prom_mock):
    prom_mock.get("/api/v1/query").mock(
        return_value=httpx.Response(
            200, json={"status": "error", "errorType": "bad_data", "error": "parse error"}
        )
    )
    resp = await api.get(M + "/query", params={"query": "!!"})
    assert resp.status_code == 502
    assert "parse error" in resp.json()["detail"]


# ------------------------------------------------------------------- dashboards


async def test_builtin_dashboards_are_listed(api, prom_mock):
    rows = (await api.get(M + "/dashboards")).json()
    ids = [r["id"] for r in rows]
    for expected in (
        "cluster-overview",
        "brokers",
        "topics",
        "consumer-lag",
        "connect",
        "flink",
        "jvm",
        "kraft",
    ):
        assert expected in ids
    assert all(r["panelCount"] > 0 for r in rows if r["builtin"])


async def test_builtin_dashboard_detail(api, prom_mock):
    body = (await api.get(M + "/dashboards/kraft")).json()
    assert body["builtin"] is True
    panels = [p for row in body["rows"] for p in row["panels"]]
    assert any(p["type"] == "stat" for p in panels)
    assert all(p["queries"] for p in panels)


async def test_dashboard_data_evaluates_every_panel(api, prom_mock):
    body = (await api.get(M + "/dashboards/consumer-lag/data", params={"range": "1h"})).json()
    assert body["configured"] is True
    assert body["step"]
    from k_shui.integrations.dashboards.builtin import get_builtin, iter_panels

    expected = {p["id"] for p in iter_panels(get_builtin("consumer-lag"))}
    assert set(body["panels"]) == expected
    for panel in body["panels"].values():
        assert panel["series"]


async def test_dashboard_data_without_prometheus():
    from httpx import ASGITransport, AsyncClient

    settings = build_settings()
    settings.clusters[0].prometheus = None
    app = build_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://itest") as client:
        body = (await client.get(M + "/dashboards/jvm/data")).json()
    assert body["configured"] is False
    assert all(p["series"] == [] for p in body["panels"].values())
    await app.state.registry.aclose()


async def test_user_dashboard_crud(api, prom_mock):
    payload = {
        "id": "my-board",
        "title": "My board",
        "tags": ["custom"],
        "rows": [
            {
                "title": "r",
                "panels": [
                    {
                        "id": "p1",
                        "title": "Brokers",
                        "type": "stat",
                        "unit": "short",
                        "queries": [{"expr": "kafka_brokers", "legend": "brokers"}],
                    }
                ],
            }
        ],
    }
    created = await api.post(M + "/dashboards", json=payload)
    assert created.status_code == 201
    assert created.json()["id"] == "my-board"

    assert "my-board" in [d["id"] for d in (await api.get(M + "/dashboards")).json()]
    assert (await api.get(M + "/dashboards/my-board")).json()["title"] == "My board"

    payload["title"] = "Renamed"
    assert (await api.put(M + "/dashboards/my-board", json=payload)).json()["title"] == "Renamed"

    data = (await api.get(M + "/dashboards/my-board/data")).json()
    assert data["panels"]["p1"]["series"]

    assert (await api.delete(M + "/dashboards/my-board")).status_code == 204
    assert (await api.get(M + "/dashboards/my-board")).status_code == 404


async def test_builtin_dashboards_cannot_be_modified(api, prom_mock):
    assert (await api.put(M + "/dashboards/jvm", json={"title": "x"})).status_code == 400
    assert (await api.delete(M + "/dashboards/jvm")).status_code == 400


async def test_grafana_import(api, prom_mock):
    grafana = {
        "uid": "abc-123",
        "title": "Kafka Grafana",
        "tags": ["kafka"],
        "templating": {"list": [{"name": "topic", "query": "label_values(kafka_topic_partitions, topic)"}]},
        "panels": [
            {
                "type": "row",
                "title": "Throughput",
                "panels": [
                    {
                        "id": 1,
                        "title": "Bytes in",
                        "type": "graph",
                        "targets": [
                            {"expr": "rate(kafka_brokers[5m])", "legendFormat": "{{pod}}", "refId": "A"}
                        ],
                        "fieldConfig": {
                            "defaults": {
                                "unit": "Bps",
                                "thresholds": {
                                    "steps": [
                                        {"value": None, "color": "green"},
                                        {"value": 10, "color": "red"},
                                    ]
                                },
                            }
                        },
                    }
                ],
            },
            {"id": 2, "title": "Count", "type": "singlestat", "targets": [{"expr": "kafka_brokers"}]},
            {"id": 3, "title": "No targets", "type": "graph", "targets": []},
        ],
    }
    resp = await api.post(M + "/dashboards/import", json=grafana)
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == "abc-123"
    assert body["variables"][0]["name"] == "topic"
    rows = body["rows"]
    assert rows[0]["title"] == "Throughput"
    panel = rows[0]["panels"][0]
    assert panel["type"] == "timeseries" and panel["unit"] == "Bps"
    assert panel["queries"][0]["legend"] == "{{pod}}"
    assert panel["thresholds"] == [{"value": 10, "color": "red"}]
    flat = [p for r in rows for p in r["panels"]]
    assert {p["id"] for p in flat} == {"1", "2"}  # panel 3 has no queries → dropped
    assert next(p for p in flat if p["id"] == "2")["type"] == "stat"
    await api.delete(M + "/dashboards/abc-123")


async def test_grafana_import_without_panels_is_rejected(api, prom_mock):
    resp = await api.post(M + "/dashboards/import", json={"title": "empty", "panels": []})
    assert resp.status_code == 400


async def test_get_overview_series_accepts_string_and_timerange(ctx, prom_mock):
    import time

    from k_shui.core.deps import TimeRange
    from k_shui.integrations.prometheus import OVERVIEW_QUERIES, get_overview_series

    by_label = await get_overview_series(ctx, "6h")
    assert [s["name"] for s in by_label] == list(OVERVIEW_QUERIES)
    assert by_label[0]["points"][0] == [1700000000000.0, 3.0]

    now = time.time()
    by_range = await get_overview_series(ctx, TimeRange(start=now - 3600, end=now, step=60.0, label="1h"))
    assert [s["name"] for s in by_range] == list(OVERVIEW_QUERIES)


async def test_get_overview_series_returns_none_without_prometheus():
    from k_shui.core.registry import ClusterRegistry
    from k_shui.integrations.prometheus import get_overview_series

    settings = build_settings()
    settings.clusters[0].prometheus = None
    registry = ClusterRegistry(settings)
    assert await get_overview_series(registry.get("itest"), "1h") is None
    await registry.aclose()


async def test_connect_metrics_endpoint_uses_prometheus(api, prom_mock):
    from k_shui.integrations.prometheus import CONNECT_QUERIES

    body = (await api.get(base("/connect/kc1/metrics"), params={"range": "1h"})).json()
    assert body["configured"] is True
    assert {s["name"] for s in body["series"]} == set(CONNECT_QUERIES)
