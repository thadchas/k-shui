"""Stream lineage: Marquez client, derived-edge builder, BFS focus and OpenLineage ingest."""

from __future__ import annotations

import httpx
import pytest
import respx

from tests.conftest_integrations import CONNECT_URL, FLINK_URL, MARQUEZ_URL, base

pytest_plugins = ["tests.conftest_integrations"]

L = base("/lineage")
TOPIC_NS = "kafka://itest"

NAMESPACES = {"namespaces": [{"name": "lakestream"}, {"name": TOPIC_NS}]}

JOBS = {
    "jobs": [
        {
            "name": "order-enrichment",
            "type": "STREAM",
            "latestRun": {"state": "COMPLETED"},
            "inputs": [{"namespace": TOPIC_NS, "name": "orders"}],
            "outputs": [{"namespace": TOPIC_NS, "name": "orders-enriched"}],
        }
    ]
}

CONNECTORS = {
    "orders-sink": {
        "info": {
            "name": "orders-sink",
            "type": "sink",
            "config": {"connector.class": "com.example.Sink", "topics": "orders-enriched"},
        },
        "status": {
            "name": "orders-sink",
            "type": "sink",
            "connector": {"state": "RUNNING"},
            "tasks": [{"id": 0, "state": "RUNNING"}],
        },
    },
    "orders-source": {
        "info": {
            "name": "orders-source",
            "type": "source",
            "config": {"connector.class": "com.example.Source", "topic": "orders"},
        },
        "status": {
            "name": "orders-source",
            "type": "source",
            "connector": {"state": "RUNNING"},
            "tasks": [{"id": 0, "state": "RUNNING"}],
        },
    },
}

FLINK_JOBS = {
    "jobs": [{"jid": "f1", "name": "order-enrichment", "state": "RUNNING", "start-time": 1, "tasks": {}}]
}
FLINK_UNKNOWN = {"jobs": [{"jid": "f2", "name": "mystery", "state": "RUNNING", "start-time": 1, "tasks": {}}]}


@pytest.fixture
def lineage_mock():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(f"{MARQUEZ_URL}/namespaces").mock(return_value=httpx.Response(200, json=NAMESPACES))
        mock.get(f"{MARQUEZ_URL}/namespaces/lakestream/jobs").mock(
            return_value=httpx.Response(200, json=JOBS)
        )
        mock.get(f"{MARQUEZ_URL}/namespaces/kafka%3A%2F%2Fitest/jobs").mock(
            return_value=httpx.Response(200, json={"jobs": []})
        )
        mock.get(f"{MARQUEZ_URL}/namespaces/lakestream/datasets").mock(
            return_value=httpx.Response(200, json={"datasets": []})
        )
        mock.get(f"{MARQUEZ_URL}/namespaces/kafka%3A%2F%2Fitest/datasets").mock(
            return_value=httpx.Response(200, json={"datasets": [{"name": "orders"}]})
        )
        mock.get(f"{CONNECT_URL}/connectors").mock(return_value=httpx.Response(200, json=CONNECTORS))
        mock.get(f"{FLINK_URL}/jobs/overview").mock(return_value=httpx.Response(200, json=FLINK_JOBS))
        yield mock


async def test_graph_merges_marquez_connect_and_flink(api, lineage_mock):
    body = (await api.get(L + "/graph", params={"sources": "marquez,connect,flink"})).json()
    nodes = {n["id"]: n for n in body["nodes"]}
    assert sorted(body["sources"]) == ["connect", "flink", "marquez"]

    # Kafka-namespaced Marquez datasets become topic nodes with stable ids.
    assert "topic:itest:orders" in nodes
    assert "topic:itest:orders-enriched" in nodes
    assert nodes["topic:itest:orders"]["type"] == "topic"
    # A topic seen by both Marquez and Connect is de-duplicated, keeping both sources.
    assert sorted(nodes["topic:itest:orders"]["sources"]) == ["connect", "marquez"]

    assert nodes["connector:itest:kc1:orders-source"]["status"] == "RUNNING"
    assert nodes["connector:itest:kc1:orders-sink"]["meta"]["connectorType"] == "sink"
    assert nodes["job:lakestream:order-enrichment"]["status"] == "COMPLETED"

    edges = {(e["source"], e["target"], e["kind"]) for e in body["edges"]}
    assert ("connector:itest:kc1:orders-source", "topic:itest:orders", "produces") in edges
    assert ("topic:itest:orders-enriched", "connector:itest:kc1:orders-sink", "consumes") in edges
    assert ("topic:itest:orders", "job:lakestream:order-enrichment", "consumes") in edges
    assert ("job:lakestream:order-enrichment", "topic:itest:orders-enriched", "produces") in edges
    # Flink job matched to the Marquez job of the same name inherits its dataset edges.
    assert ("topic:itest:orders", "flinkJob:itest:flink1:f1", "consumes") in edges
    assert ("flinkJob:itest:flink1:f1", "topic:itest:orders-enriched", "produces") in edges


async def test_flink_vertex_heuristics_when_marquez_has_no_job(api, lineage_mock):
    lineage_mock.get(f"{FLINK_URL}/jobs/overview").mock(return_value=httpx.Response(200, json=FLINK_UNKNOWN))
    lineage_mock.get(f"{FLINK_URL}/jobs/f2").mock(
        return_value=httpx.Response(
            200,
            json={
                "jid": "f2",
                "vertices": [
                    {"id": "v1", "name": "Source: orders"},
                    {"id": "v2", "name": "Sink: orders-enriched Writer"},
                ],
            },
        )
    )
    body = (await api.get(L + "/graph")).json()
    edges = {(e["source"], e["target"], e["kind"]) for e in body["edges"]}
    assert ("topic:itest:orders", "flinkJob:itest:flink1:f2", "consumes") in edges
    assert ("flinkJob:itest:flink1:f2", "topic:itest:orders-enriched", "produces") in edges


async def test_graph_focus_and_depth(api, lineage_mock):
    full = (await api.get(L + "/graph")).json()
    focused = (await api.get(L + "/graph", params={"focus": "topic:itest:orders", "depth": 1})).json()
    assert focused["focus"] == "topic:itest:orders"
    assert len(focused["nodes"]) < len(full["nodes"])
    ids = {n["id"] for n in focused["nodes"]}
    assert "topic:itest:orders" in ids
    assert "connector:itest:kc1:orders-source" in ids
    assert "connector:itest:kc1:orders-sink" not in ids  # two hops away


async def test_graph_focus_unknown_node(api, lineage_mock):
    body = (await api.get(L + "/graph", params={"focus": "topic:itest:nope"})).json()
    assert body["nodes"] == [] and body["edges"] == []


async def test_source_filter_limits_builders(api, lineage_mock):
    body = (await api.get(L + "/graph", params={"sources": "connect"})).json()
    assert body["sources"] == ["connect"]
    assert not any(n["type"] == "job" for n in body["nodes"])


async def test_node_detail_includes_neighbours_and_runs(api, lineage_mock):
    lineage_mock.get(f"{MARQUEZ_URL}/namespaces/lakestream/jobs/order-enrichment/runs").mock(
        return_value=httpx.Response(200, json={"runs": [{"id": "r1", "state": "COMPLETED"}]})
    )
    body = (await api.get(L + "/nodes/job:lakestream:order-enrichment")).json()
    assert body["type"] == "job"
    assert "topic:itest:orders" in body["upstream"]
    assert "topic:itest:orders-enriched" in body["downstream"]
    assert body["latestRuns"][0]["id"] == "r1"


async def test_node_detail_unknown_is_404(api, lineage_mock):
    assert (await api.get(L + "/nodes/topic:itest:ghost")).status_code == 404


async def test_search_combines_local_and_marquez(api, lineage_mock):
    lineage_mock.get(f"{MARQUEZ_URL}/search").mock(
        return_value=httpx.Response(
            200, json={"results": [{"type": "DATASET", "name": "orders", "nodeId": "dataset:x:orders"}]}
        )
    )
    body = (await api.get(L + "/search", params={"q": "orders"})).json()
    assert body["query"] == "orders"
    assert any(r["name"] == "orders" for r in body["results"])
    assert body["marquez"][0]["nodeId"] == "dataset:x:orders"


async def test_namespaces_datasets_jobs_and_runs(api, lineage_mock):
    assert [n["name"] for n in (await api.get(L + "/namespaces")).json()] == [
        "lakestream",
        TOPIC_NS,
    ]
    datasets = (await api.get(L + "/datasets", params={"namespace": TOPIC_NS})).json()
    assert datasets[0]["name"] == "orders" and datasets[0]["namespace"] == TOPIC_NS
    jobs = (await api.get(L + "/jobs", params={"namespace": "lakestream"})).json()
    assert jobs[0]["name"] == "order-enrichment"

    lineage_mock.get(f"{MARQUEZ_URL}/namespaces/lakestream/jobs/order-enrichment/runs").mock(
        return_value=httpx.Response(200, json={"runs": [{"id": "r1"}]})
    )
    runs = (await api.get(L + "/runs", params={"jobId": "job:lakestream:order-enrichment"})).json()
    assert runs[0]["id"] == "r1"


async def test_raw_marquez_graph_passthrough(api, lineage_mock):
    lineage_mock.get(f"{MARQUEZ_URL}/lineage").mock(
        return_value=httpx.Response(200, json={"graph": [{"id": "dataset:x:orders", "type": "DATASET"}]})
    )
    body = (await api.get(L + "/marquez", params={"nodeId": "dataset:x:orders"})).json()
    assert body["graph"][0]["type"] == "DATASET"


async def test_openlineage_forwarded_to_marquez(api, lineage_mock):
    route = lineage_mock.post(f"{MARQUEZ_URL}/lineage").mock(return_value=httpx.Response(201))
    event = {"eventType": "COMPLETE", "job": {"namespace": "ns", "name": "j"}}
    resp = await api.post("/api/v1/lineage/openlineage", json=event)
    assert resp.status_code == 202
    assert resp.json() == {"accepted": True, "forwarded": True, "status": 201, "stored": 0}
    assert route.called


async def test_openlineage_stored_locally_without_marquez():
    from httpx import ASGITransport, AsyncClient

    from k_shui.integrations.memstore import openlineage_events
    from tests.conftest_integrations import build_app, build_settings

    openlineage_events.clear()
    settings = build_settings()
    settings.clusters[0].lineage = None
    app = build_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://itest") as client:
        resp = await client.post("/api/v1/lineage/openlineage", json={"eventType": "START"})
        assert resp.json()["forwarded"] is False
        assert resp.json()["stored"] == 1
        stored = (await client.get("/api/v1/lineage/openlineage")).json()
        assert stored["total"] == 1
        assert stored["items"][0]["event"]["eventType"] == "START"
    openlineage_events.clear()
    await app.state.registry.aclose()
