"""Kafka Connect + replication (MirrorMaker2 / Replicator) tests."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tests.conftest_integrations import CONNECT_NAME, CONNECT_URL, base, build_app

pytest_plugins = ["tests.conftest_integrations"]

KC = base(f"/connect/{CONNECT_NAME}")

ROOT = {"version": "4.3.1", "commit": "abc123", "kafka_cluster_id": "clusterX"}

SOURCE_CONFIG = {
    "connector.class": "org.apache.kafka.connect.file.FileStreamSourceConnector",
    "topic": "orders",
    "tasks.max": "2",
    "name": "orders-source",
}
SINK_CONFIG = {
    "connector.class": "com.example.SinkConnector",
    "topics": "orders,payments",
    "tasks.max": "1",
    "name": "audit-sink",
}

EXPANDED = {
    "orders-source": {
        "info": {"name": "orders-source", "config": SOURCE_CONFIG, "type": "source"},
        "status": {
            "name": "orders-source",
            "type": "source",
            "connector": {"state": "RUNNING", "worker_id": "w1:8083"},
            "tasks": [{"id": 0, "state": "RUNNING", "worker_id": "w1:8083"}],
        },
    },
    "audit-sink": {
        "info": {"name": "audit-sink", "config": SINK_CONFIG, "type": "sink"},
        "status": {
            "name": "audit-sink",
            "type": "sink",
            "connector": {"state": "FAILED", "worker_id": "w1:8083", "trace": "boom"},
            "tasks": [{"id": 0, "state": "FAILED", "worker_id": "w1:8083", "trace": "task boom"}],
        },
    },
}


@pytest.fixture
def kc_mock():
    with respx.mock(base_url=CONNECT_URL, assert_all_called=False) as mock:
        mock.get("/").mock(return_value=httpx.Response(200, json=ROOT))
        mock.get("/connectors").mock(return_value=httpx.Response(200, json=EXPANDED))
        yield mock


async def test_list_connect_clusters_rolls_up_tasks(api, kc_mock):
    body = (await api.get(base("/connect"))).json()
    assert len(body) == 1
    row = body[0]
    assert row["name"] == CONNECT_NAME
    assert row["status"] == "online"
    assert row["version"] == "4.3.1"
    assert row["kafkaClusterId"] == "clusterX"
    assert row["connectorCount"] == 2
    assert row["runningTasks"] == 1
    assert row["failedTasks"] == 1
    assert row["failedConnectors"] == 1


async def test_offline_connect_cluster_is_reported_not_raised(api, kc_mock):
    kc_mock.get("/").mock(side_effect=httpx.ConnectError("refused"))
    body = (await api.get(base("/connect"))).json()
    assert body[0]["status"] == "offline"


async def test_list_connectors_normalises_fields(api, kc_mock):
    rows = {c["name"]: c for c in (await api.get(KC + "/connectors")).json()}
    source = rows["orders-source"]
    assert source["type"] == "source"
    assert source["topics"] == ["orders"]
    assert source["tasksMax"] == 2
    assert source["connectorClassShort"] == "FileStreamSourceConnector"
    sink = rows["audit-sink"]
    assert sink["topics"] == ["orders", "payments"]
    assert sink["state"] == "FAILED"
    assert sink["failedTasks"] == 1
    assert sink["tasks"][0]["workerId"] == "w1:8083"
    assert sink["tasks"][0]["trace"] == "task boom"


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"search": "sink"}, ["audit-sink"]),
        ({"state": "running"}, ["orders-source"]),
        ({"type": "sink"}, ["audit-sink"]),
    ],
)
async def test_connector_filters(api, kc_mock, params, expected):
    rows = (await api.get(KC + "/connectors", params=params)).json()
    assert [r["name"] for r in rows] == expected


async def test_connector_detail_merges_active_topics(api, kc_mock):
    kc_mock.get("/connectors/orders-source").mock(
        return_value=httpx.Response(200, json=EXPANDED["orders-source"]["info"])
    )
    kc_mock.get("/connectors/orders-source/status").mock(
        return_value=httpx.Response(200, json=EXPANDED["orders-source"]["status"])
    )
    kc_mock.get("/connectors/orders-source/topics").mock(
        return_value=httpx.Response(200, json={"orders-source": {"topics": ["orders", "orders.dlq"]}})
    )
    body = (await api.get(KC + "/connectors/orders-source")).json()
    assert body["topics"] == ["orders", "orders.dlq"]


async def test_create_connector(api, kc_mock):
    created = kc_mock.post("/connectors").mock(
        return_value=httpx.Response(201, json={"name": "new", "config": SOURCE_CONFIG})
    )
    kc_mock.get("/connectors/new").mock(
        return_value=httpx.Response(200, json={"name": "new", "config": SOURCE_CONFIG, "type": "source"})
    )
    kc_mock.get("/connectors/new/status").mock(
        return_value=httpx.Response(
            200, json={"connector": {"state": "RUNNING"}, "tasks": [], "type": "source"}
        )
    )
    kc_mock.get("/connectors/new/topics").mock(return_value=httpx.Response(200, json={}))
    resp = await api.post(KC + "/connectors", json={"name": "new", "config": SOURCE_CONFIG})
    assert resp.status_code == 201
    assert resp.json()["name"] == "new"
    assert json.loads(created.calls.last.request.content)["config"]["name"] == "new"


async def test_put_config_returns_detail(api, kc_mock):
    kc_mock.put("/connectors/orders-source/config").mock(
        return_value=httpx.Response(200, json={"name": "orders-source", "config": SOURCE_CONFIG})
    )
    kc_mock.get("/connectors/orders-source").mock(
        return_value=httpx.Response(200, json=EXPANDED["orders-source"]["info"])
    )
    kc_mock.get("/connectors/orders-source/status").mock(
        return_value=httpx.Response(200, json=EXPANDED["orders-source"]["status"])
    )
    kc_mock.get("/connectors/orders-source/topics").mock(return_value=httpx.Response(200, json={}))
    resp = await api.put(KC + "/connectors/orders-source/config", json=SOURCE_CONFIG)
    assert resp.json()["state"] == "RUNNING"


@pytest.mark.parametrize("action", ["pause", "resume", "stop"])
async def test_lifecycle_actions(api, kc_mock, action):
    route = kc_mock.put(f"/connectors/orders-source/{action}").mock(return_value=httpx.Response(202))
    resp = await api.post(f"{KC}/connectors/orders-source/{action}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert route.called


async def test_stop_falls_back_to_pause_on_old_workers(api, kc_mock):
    kc_mock.put("/connectors/orders-source/stop").mock(return_value=httpx.Response(404))
    pause = kc_mock.put("/connectors/orders-source/pause").mock(return_value=httpx.Response(202))
    resp = await api.post(f"{KC}/connectors/orders-source/stop")
    assert resp.status_code == 200
    assert pause.called


async def test_restart_passes_flags(api, kc_mock):
    route = kc_mock.post("/connectors/audit-sink/restart").mock(
        return_value=httpx.Response(200, json={"name": "audit-sink", "connector": {"state": "RESTARTING"}})
    )
    resp = await api.post(
        f"{KC}/connectors/audit-sink/restart", params={"includeTasks": True, "onlyFailed": True}
    )
    assert resp.status_code == 200
    query = route.calls.last.request.url.query
    assert b"includeTasks=true" in query and b"onlyFailed=true" in query


async def test_unknown_action_is_bad_request(api, kc_mock):
    resp = await api.post(f"{KC}/connectors/orders-source/explode")
    assert resp.status_code == 400
    assert resp.json()["type"].endswith("bad-request")


async def test_task_restart(api, kc_mock):
    route = kc_mock.post("/connectors/audit-sink/tasks/0/restart").mock(return_value=httpx.Response(204))
    assert (await api.post(f"{KC}/connectors/audit-sink/tasks/0/restart")).status_code == 204
    assert route.called


async def test_topics_and_reset(api, kc_mock):
    kc_mock.get("/connectors/audit-sink/topics").mock(
        return_value=httpx.Response(200, json={"audit-sink": {"topics": ["orders"]}})
    )
    assert (await api.get(KC + "/connectors/audit-sink/topics")).json() == {
        "name": "audit-sink",
        "topics": ["orders"],
    }
    reset = kc_mock.put("/connectors/audit-sink/topics/reset").mock(return_value=httpx.Response(204))
    assert (await api.put(KC + "/connectors/audit-sink/topics/reset")).status_code == 204
    assert reset.called


async def test_offsets_get_patch_delete(api, kc_mock):
    offsets = {
        "offsets": [
            {"partition": {"kafka_topic": "orders", "kafka_partition": 0}, "offset": {"kafka_offset": 10}}
        ]
    }
    kc_mock.get("/connectors/audit-sink/offsets").mock(return_value=httpx.Response(200, json=offsets))
    assert (await api.get(KC + "/connectors/audit-sink/offsets")).json() == offsets

    patch = kc_mock.patch("/connectors/audit-sink/offsets").mock(
        return_value=httpx.Response(200, json={"message": "ok"})
    )
    resp = await api.patch(KC + "/connectors/audit-sink/offsets", json=offsets)
    assert resp.json() == {"message": "ok"}
    assert json.loads(patch.calls.last.request.content)["offsets"][0]["offset"]["kafka_offset"] == 10

    kc_mock.delete("/connectors/audit-sink/offsets").mock(
        return_value=httpx.Response(200, json={"message": "reset"})
    )
    assert (await api.delete(KC + "/connectors/audit-sink/offsets")).json() == {"message": "reset"}


async def test_delete_connector(api, kc_mock):
    route = kc_mock.delete("/connectors/audit-sink").mock(return_value=httpx.Response(204))
    assert (await api.delete(KC + "/connectors/audit-sink")).status_code == 204
    assert route.called


async def test_validate_is_viewer_level(integration_settings, kc_mock):
    from httpx import ASGITransport, AsyncClient

    from k_shui.config import AuthConfig, BasicAuthUser
    from k_shui.core.auth import Principal, create_token

    integration_settings.auth = AuthConfig(
        type="basic",
        jwtSecret="s",
        users=[BasicAuthUser(username="vi", password="vipw", role="viewer")],
    )
    token, _ = create_token(integration_settings, Principal(username="vi", role="viewer"))
    headers = {"Authorization": f"Bearer {token}"}
    kc_mock.put("/connector-plugins/com.example.SinkConnector/config/validate").mock(
        return_value=httpx.Response(
            200, json={"name": "com.example.SinkConnector", "error_count": 0, "configs": []}
        )
    )
    app = build_app(integration_settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://itest") as client:
        resp = await client.put(
            KC + "/plugins/com.example.SinkConnector/validate", json={"name": "x"}, headers=headers
        )
        assert resp.status_code == 200, resp.text
        resp = await client.post(KC + "/connectors", json={"name": "x", "config": {}}, headers=headers)
        assert resp.status_code == 403
    await app.state.registry.aclose()


async def test_plugins_and_validate(api, kc_mock):
    kc_mock.get("/connector-plugins").mock(
        return_value=httpx.Response(
            200, json=[{"class": "com.example.SinkConnector", "type": "sink", "version": "1.0"}]
        )
    )
    plugins = (await api.get(KC + "/plugins")).json()
    assert plugins[0]["classShort"] == "SinkConnector"

    kc_mock.put("/connector-plugins/com.example.SinkConnector/config/validate").mock(
        return_value=httpx.Response(
            200,
            json={
                "name": "com.example.SinkConnector",
                "error_count": 1,
                "groups": ["Common"],
                "configs": [
                    {
                        "definition": {
                            "name": "topics",
                            "type": "LIST",
                            "required": True,
                            "default_value": None,
                            "importance": "HIGH",
                            "documentation": "topics",
                            "group": "Common",
                            "display_name": "Topics",
                            "dependents": [],
                            "order": 1,
                        },
                        "value": {
                            "name": "topics",
                            "value": None,
                            "recommended_values": [],
                            "errors": ["Missing required configuration"],
                            "visible": True,
                        },
                    }
                ],
            },
        )
    )
    body = (await api.put(KC + "/plugins/com.example.SinkConnector/validate", json={"name": "x"})).json()
    assert body["errorCount"] == 1
    assert body["configs"][0]["definition"]["required"] is True
    assert body["configs"][0]["value"]["errors"] == ["Missing required configuration"]


async def test_unknown_connect_cluster_is_404(api, kc_mock):
    resp = await api.get(base("/connect/nope/connectors"))
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("not-found")


# ------------------------------------------------------------------- replication

MM2 = {
    "mm2-source": {
        "info": {
            "name": "mm2-source",
            "type": "source",
            "config": {
                "connector.class": "org.apache.kafka.connect.mirror.MirrorSourceConnector",
                "source.cluster.alias": "east",
                "target.cluster.alias": "west",
                "source.cluster.bootstrap.servers": "east-kafka:9092",
                "target.cluster.bootstrap.servers": "west-kafka:9092",
                "topics": "orders,payments",
                "replication.policy.class": "org.apache.kafka.connect.mirror.DefaultReplicationPolicy",
            },
        },
        "status": {
            "name": "mm2-source",
            "type": "source",
            "connector": {"state": "RUNNING"},
            "tasks": [{"id": 0, "state": "RUNNING"}],
        },
    },
    "mm2-checkpoint": {
        "info": {
            "name": "mm2-checkpoint",
            "type": "source",
            "config": {
                "connector.class": "org.apache.kafka.connect.mirror.MirrorCheckpointConnector",
                "source.cluster.alias": "east",
                "target.cluster.alias": "west",
                "groups": ".*",
            },
        },
        "status": {
            "name": "mm2-checkpoint",
            "type": "source",
            "connector": {"state": "FAILED"},
            "tasks": [{"id": 0, "state": "FAILED"}],
        },
    },
}


async def test_replication_detects_mirrormaker2(api, kc_mock):
    kc_mock.get("/connectors").mock(return_value=httpx.Response(200, json=MM2))
    body = (await api.get(base("/replication"))).json()
    assert body["supported"] is True and body["detected"] is True
    kinds = {f["connectorName"]: f["kind"] for f in body["flows"]}
    assert kinds == {"mm2-source": "source", "mm2-checkpoint": "checkpoint"}
    flow = next(f for f in body["flows"] if f["kind"] == "source")
    assert flow["sourceAlias"] == "east" and flow["targetAlias"] == "west"
    assert flow["sourceBootstrapServers"] == "east-kafka:9092"
    assert flow["topicsPattern"] == "orders,payments"
    link = body["links"][0]
    assert link["source"] == "east" and link["target"] == "west"
    assert sorted(link["kinds"]) == ["checkpoint", "source"]
    assert link["state"] == "FAILED"
    assert link["failedTasks"] == 1


async def test_replication_reports_none_when_no_mirror_connectors(api, kc_mock):
    body = (await api.get(base("/replication"))).json()
    assert body["detected"] is False
    assert body["connectClusters"] == [CONNECT_NAME]
