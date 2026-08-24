"""ksqlDB client + router tests, including the SSE streaming query protocols."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tests.conftest_integrations import KSQL_NAME, KSQL_URL, base

pytest_plugins = ["tests.conftest_integrations"]

KS = base(f"/ksql/{KSQL_NAME}")

INFO = {
    "KsqlServerInfo": {
        "version": "7.6.0",
        "kafkaClusterId": "clusterX",
        "ksqlServiceId": "default_",
        "serverStatus": "RUNNING",
    }
}


def sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        name, payload = None, {}
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                payload = json.loads(line[6:])
        if name:
            events.append((name, payload))
    return events


@pytest.fixture
def ksql_mock():
    with respx.mock(base_url=KSQL_URL, assert_all_called=False) as mock:
        mock.get("/info").mock(return_value=httpx.Response(200, json=INFO))
        mock.get("/healthcheck").mock(return_value=httpx.Response(200, json={"isHealthy": True}))
        yield mock


async def test_list_servers(api, ksql_mock):
    rows = (await api.get(base("/ksql"))).json()
    assert rows[0]["name"] == KSQL_NAME
    assert rows[0]["version"] == "7.6.0"
    assert rows[0]["serverStatus"] == "RUNNING"
    assert rows[0]["healthy"] is True


async def test_unreachable_server_is_reported(api, ksql_mock):
    ksql_mock.get("/info").mock(side_effect=httpx.ConnectError("down"))
    ksql_mock.get("/healthcheck").mock(side_effect=httpx.ConnectError("down"))
    rows = (await api.get(base("/ksql"))).json()
    assert rows[0]["serverStatus"] == "UNREACHABLE"
    assert rows[0]["healthy"] is False


async def test_statement_appends_semicolon_and_records_history(api, ksql_mock):
    route = ksql_mock.post("/ksql").mock(
        return_value=httpx.Response(
            200, json=[{"@type": "currentStatus", "commandStatus": {"status": "SUCCESS"}}]
        )
    )
    resp = await api.post(KS + "/statement", json={"sql": "CREATE STREAM s (a VARCHAR)"})
    assert resp.status_code == 200
    assert json.loads(route.calls.last.request.content)["ksql"].endswith(";")

    history = (await api.get(KS + "/history")).json()
    assert history[0]["kind"] == "statement"
    assert history[0]["ok"] is True
    assert history[0]["server"] == KSQL_NAME


async def test_statement_error_is_upstream_problem_and_history_records_failure(api, ksql_mock):
    ksql_mock.post("/ksql").mock(return_value=httpx.Response(400, json={"message": "line 1: syntax error"}))
    resp = await api.post(KS + "/statement", json={"sql": "SELECT nope"})
    assert resp.status_code == 502
    assert "syntax error" in resp.json()["detail"]
    history = (await api.get(KS + "/history")).json()
    assert history[0]["ok"] is False


async def test_streams_and_tables_use_extended_describe(api, ksql_mock):
    ksql_mock.post("/ksql").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "@type": "sourceDescriptionList",
                    "sourceDescriptions": [
                        {
                            "name": "ORDERS",
                            "topic": "orders",
                            "keyFormat": "KAFKA",
                            "valueFormat": "JSON",
                            "type": "STREAM",
                            "partitions": 6,
                            "replication": 3,
                            "fields": [{"name": "ID", "schema": {"type": "STRING"}}],
                            "readQueries": [{"id": "CSAS_1"}],
                            "writeQueries": [],
                        }
                    ],
                }
            ],
        )
    )
    rows = (await api.get(KS + "/streams")).json()
    assert rows[0]["name"] == "ORDERS"
    assert rows[0]["topic"] == "orders"
    assert rows[0]["valueFormat"] == "JSON"


async def test_streams_fallback_to_show_streams(api, ksql_mock):
    responses = [
        httpx.Response(200, json=[{"@type": "sourceDescriptionList", "sourceDescriptions": []}]),
        httpx.Response(
            200,
            json=[
                {
                    "@type": "streams",
                    "streams": [{"name": "S1", "topic": "t1", "keyFormat": "KAFKA", "valueFormat": "AVRO"}],
                }
            ],
        ),
    ]
    ksql_mock.post("/ksql").mock(side_effect=responses)
    rows = (await api.get(KS + "/streams")).json()
    assert rows == [
        {
            "name": "S1",
            "topic": "t1",
            "keyFormat": "KAFKA",
            "valueFormat": "AVRO",
            "type": "STREAM",
            "windowed": False,
        }
    ]


async def test_queries_and_terminate(api, ksql_mock):
    ksql_mock.post("/ksql").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "@type": "queries",
                    "queries": [
                        {
                            "id": "CSAS_1",
                            "queryString": "CREATE STREAM ...",
                            "sinks": ["OUT"],
                            "sinkKafkaTopics": ["out"],
                            "state": "RUNNING",
                            "queryType": "PERSISTENT",
                        }
                    ],
                }
            ],
        )
    )
    rows = (await api.get(KS + "/queries")).json()
    assert rows[0]["id"] == "CSAS_1"
    assert rows[0]["sinkKafkaTopics"] == ["out"]

    resp = await api.delete(KS + "/queries/CSAS_1")
    assert resp.json()["terminated"] is True


async def test_describe(api, ksql_mock):
    ksql_mock.post("/ksql").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "@type": "sourceDescription",
                    "sourceDescription": {"name": "ORDERS", "topic": "orders", "type": "STREAM"},
                }
            ],
        )
    )
    body = (await api.get(KS + "/streams/ORDERS")).json()
    assert body["name"] == "ORDERS"


async def test_query_stream_delimited_protocol(api, ksql_mock):
    payload = (
        b'{"queryId":"q1","columnNames":["A","B"],"columnTypes":["STRING","INTEGER"]}\n["x",1]\n["y",2]\n'
    )
    ksql_mock.post("/query-stream").mock(return_value=httpx.Response(200, content=payload))
    resp = await api.post(KS + "/query", json={"sql": "SELECT * FROM S EMIT CHANGES"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = sse_events(resp.text)
    assert events[0][0] == "header"
    assert events[0][1]["columnNames"] == ["A", "B"]
    assert events[0][1]["queryId"] == "q1"
    assert [e[1]["values"] for e in events if e[0] == "row"] == [["x", 1], ["y", 2]]
    assert events[1][1]["row"] == {"A": "x", "B": 1}
    assert events[-1][0] == "end"


async def test_query_stream_falls_back_to_legacy_endpoint(api, ksql_mock):
    ksql_mock.post("/query-stream").mock(return_value=httpx.Response(404, json={"message": "nope"}))
    legacy = (
        b'[{"header":{"queryId":"q2","schema":"`A` STRING, `B` INTEGER"}},\n'
        b'{"row":{"columns":["p",7]}},\n'
        b'{"finalMessage":"Limit Reached"}]'
    )
    ksql_mock.post("/query").mock(return_value=httpx.Response(200, content=legacy))
    resp = await api.post(KS + "/query", json={"sql": "SELECT * FROM S"})
    events = sse_events(resp.text)
    header = next(e for e in events if e[0] == "header")[1]
    assert header["columnNames"] == ["A", "B"]
    assert header["columnTypes"] == ["STRING", "INTEGER"]
    row = next(e for e in events if e[0] == "row")[1]
    assert row["row"] == {"A": "p", "B": 7}
    assert events[-1][0] == "end"


async def test_query_stream_reports_upstream_error_as_sse_error(api, ksql_mock):
    ksql_mock.post("/query-stream").mock(return_value=httpx.Response(404, json={"message": "gone"}))
    ksql_mock.post("/query").mock(return_value=httpx.Response(400, json={"message": "bad sql"}))
    resp = await api.post(KS + "/query", json={"sql": "SELECT"})
    events = sse_events(resp.text)
    assert events[0][0] == "error"
    assert "bad sql" in events[0][1]["message"]
    assert events[-1][0] == "end"


async def test_no_ksql_configured_returns_problem(api, integration_app):
    from k_shui.config import ClusterConfig
    from k_shui.core.registry import ClusterContext

    registry = integration_app.state.registry
    registry._contexts["bare"] = ClusterContext(
        ClusterConfig(id="bare", bootstrapServers="x:9092"), integration_app.state.settings
    )
    resp = await api.get("/api/v1/clusters/bare/ksql")
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("integration-not-configured")
