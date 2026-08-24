"""Flink proxy tests: camelCase normalisation, job lifecycle, jars and SQL Gateway."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tests.conftest_integrations import FLINK_NAME, FLINK_URL, base, build_app, build_settings

pytest_plugins = ["tests.conftest_integrations"]

FC = base(f"/flink/{FLINK_NAME}")
JID = "d41871fe546c4afb7fdb5182a1f13e43"

OVERVIEW = {
    "taskmanagers": 1,
    "slots-total": 4,
    "slots-available": 2,
    "jobs-running": 2,
    "jobs-finished": 0,
    "jobs-cancelled": 0,
    "jobs-failed": 1,
    "flink-version": "1.20.2",
    "flink-commit": "1641cb9",
}

JOBS_OVERVIEW = {
    "jobs": [
        {
            "jid": JID,
            "name": "order-enrichment",
            "start-time": 1787490290623,
            "end-time": -1,
            "duration": 51286797,
            "state": "RUNNING",
            "last-modification": 1787490302907,
            "tasks": {"running": 1, "total": 1, "failed": 0},
        }
    ]
}

JOB_DETAIL = {
    "jid": JID,
    "name": "order-enrichment",
    "state": "RUNNING",
    "job-type": "STREAMING",
    "start-time": 1787490290623,
    "end-time": -1,
    "vertices": [
        {
            "id": "v1",
            "name": "Source: orders -> Sink: enriched",
            "parallelism": 1,
            "status": "RUNNING",
            "start-time": 1787490301125,
            "metrics": {"read-bytes": 12, "write-records": 5},
        }
    ],
    "status-counts": {"RUNNING": 1, "FAILED": 0},
    "plan": {"jid": JID, "nodes": [{"id": "v1", "description": "Source"}]},
}


@pytest.fixture
def flink_mock():
    with respx.mock(base_url=FLINK_URL, assert_all_called=False) as mock:
        mock.get("/overview").mock(return_value=httpx.Response(200, json=OVERVIEW))
        mock.get("/jobs/overview").mock(return_value=httpx.Response(200, json=JOBS_OVERVIEW))
        mock.get(f"/jobs/{JID}").mock(return_value=httpx.Response(200, json=JOB_DETAIL))
        yield mock


async def test_list_clusters_normalises_overview(api, flink_mock):
    row = (await api.get(base("/flink"))).json()[0]
    assert row == {
        "name": FLINK_NAME,
        "url": FLINK_URL,
        "sqlGateway": False,
        "status": "online",
        "version": "1.20.2",
        "taskmanagers": 1,
        "slotsTotal": 4,
        "slotsAvailable": 2,
        "jobsRunning": 2,
        "jobsFinished": 0,
        "jobsCancelled": 0,
        "jobsFailed": 1,
        "commit": "1641cb9",
    }


async def test_offline_cluster_degrades(api, flink_mock):
    flink_mock.get("/overview").mock(side_effect=httpx.ConnectError("down"))
    assert (await api.get(base("/flink"))).json()[0]["status"] == "offline"


async def test_jobs_are_camelcased(api, flink_mock):
    job = (await api.get(FC + "/jobs")).json()[0]
    assert job["startTime"] == 1787490290623
    assert job["endTime"] == -1
    assert job["tasks"]["running"] == 1
    assert "start-time" not in job


async def test_job_detail_includes_vertices_and_plan(api, flink_mock):
    body = (await api.get(f"{FC}/jobs/{JID}")).json()
    assert body["jobType"] == "STREAMING"
    assert body["statusCounts"]["RUNNING"] == 1
    assert body["vertices"][0]["startTime"] == 1787490301125
    assert body["vertices"][0]["metrics"]["readBytes"] == 12
    assert body["plan"]["nodes"][0]["id"] == "v1"


async def test_checkpoints_snake_case_is_camelised(api, flink_mock):
    flink_mock.get(f"/jobs/{JID}/checkpoints").mock(
        return_value=httpx.Response(
            200,
            json={
                "counts": {"restored": 0, "total": 12, "in_progress": 1, "completed": 10, "failed": 1},
                "summary": {"end_to_end_duration": {"min": 2, "max": 9}},
                "latest": {"completed": {"checkpoint_type": "CHECKPOINT"}},
            },
        )
    )
    body = (await api.get(f"{FC}/jobs/{JID}/checkpoints")).json()
    assert body["counts"]["inProgress"] == 1
    assert body["summary"]["endToEndDuration"]["max"] == 9
    assert body["latest"]["completed"]["checkpointType"] == "CHECKPOINT"


async def test_vertex_endpoints(api, flink_mock):
    flink_mock.get(f"/jobs/{JID}/vertices/v1/backpressure").mock(
        return_value=httpx.Response(
            200,
            json={"status": "ok", "backpressure-level": "low", "subtasks": [{"subtask": 0, "ratio": 0.0}]},
        )
    )
    body = (await api.get(f"{FC}/jobs/{JID}/vertices/v1/backpressure")).json()
    assert body["backpressureLevel"] == "low"

    flink_mock.get(f"/jobs/{JID}/vertices/v1/watermarks").mock(
        return_value=httpx.Response(200, json=[{"id": "0.currentInputWatermark", "value": "17"}])
    )
    assert (await api.get(f"{FC}/jobs/{JID}/vertices/v1/watermarks")).json()[0]["value"] == "17"

    flink_mock.get(f"/jobs/{JID}/vertices/v1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "v1",
                "name": "Source",
                "parallelism": 1,
                "subtasks": [{"subtask": 0, "status": "RUNNING"}],
            },
        )
    )
    flink_mock.get(f"/jobs/{JID}/vertices/v1/subtasktimes").mock(
        return_value=httpx.Response(200, json={"subtasks": [{"subtask": 0, "duration": 5}]})
    )
    body = (await api.get(f"{FC}/jobs/{JID}/vertices/v1/subtasks")).json()
    assert body["subtasks"][0]["status"] == "RUNNING"
    assert body["times"][0]["duration"] == 5


async def test_cancel_uses_patch_with_mode(api, flink_mock):
    route = flink_mock.patch(f"/jobs/{JID}").mock(return_value=httpx.Response(202, json={}))
    resp = await api.patch(f"{FC}/jobs/{JID}", params={"mode": "stop"})
    assert resp.json() == {"jid": JID, "mode": "stop", "requested": True}
    assert b"mode=stop" in route.calls.last.request.url.query


async def test_cancel_rejects_bad_mode(api, flink_mock):
    assert (await api.patch(f"{FC}/jobs/{JID}", params={"mode": "explode"})).status_code == 422


async def test_savepoint_trigger_and_status(api, flink_mock):
    route = flink_mock.post(f"/jobs/{JID}/savepoints").mock(
        return_value=httpx.Response(202, json={"request-id": "trg-1"})
    )
    resp = await api.post(
        f"{FC}/jobs/{JID}/savepoints", json={"targetDirectory": "s3://sp", "cancelJob": True}
    )
    assert resp.json() == {"triggerId": "trg-1", "jid": JID}
    body = json.loads(route.calls.last.request.content)
    assert body["target-directory"] == "s3://sp" and body["cancel-job"] is True

    flink_mock.get(f"/jobs/{JID}/savepoints/trg-1").mock(
        return_value=httpx.Response(
            200, json={"status": {"id": "COMPLETED"}, "operation": {"location": "s3://sp/x"}}
        )
    )
    status = (await api.get(f"{FC}/jobs/{JID}/savepoints/trg-1")).json()
    assert status["status"]["id"] == "COMPLETED"


async def test_taskmanagers_and_logs(api, flink_mock):
    flink_mock.get("/taskmanagers").mock(
        return_value=httpx.Response(
            200,
            json={
                "taskmanagers": [
                    {
                        "id": "tm-1",
                        "dataPort": 1234,
                        "slotsNumber": 4,
                        "freeSlots": 2,
                        "totalResource": {"cpuCores": 0.6},
                    }
                ]
            },
        )
    )
    rows = (await api.get(FC + "/taskmanagers")).json()
    assert rows[0]["id"] == "tm-1" and rows[0]["freeSlots"] == 2

    flink_mock.get("/taskmanagers/tm-1/logs").mock(
        return_value=httpx.Response(200, json={"logs": [{"name": "tm.log", "size": 10}]})
    )
    assert (await api.get(FC + "/taskmanagers/tm-1/logs")).json()["logs"][0]["name"] == "tm.log"

    flink_mock.get("/taskmanagers/tm-1/logs/tm.log").mock(
        return_value=httpx.Response(200, text="line one\nline two")
    )
    resp = await api.get(FC + "/taskmanagers/tm-1/logs", params={"file": "tm.log"})
    assert resp.text == "line one\nline two"

    flink_mock.get("/taskmanagers/tm-1/thread-dump").mock(
        return_value=httpx.Response(200, json={"threadInfos": [{"threadName": "main"}]})
    )
    assert (await api.get(FC + "/taskmanagers/tm-1/thread-dump")).json()["threadInfos"][0][
        "threadName"
    ] == "main"


async def test_jobmanager_config_keys_are_not_camelised(api, flink_mock):
    flink_mock.get("/jobmanager/config").mock(
        return_value=httpx.Response(200, json=[{"key": "taskmanager.numberOfTaskSlots", "value": "4"}])
    )
    body = (await api.get(FC + "/jobmanager/config")).json()
    assert body[0]["key"] == "taskmanager.numberOfTaskSlots"


async def test_jars_upload_run_delete(api, flink_mock):
    flink_mock.get("/jars").mock(
        return_value=httpx.Response(200, json={"address": "http://jm:8081", "files": []})
    )
    assert (await api.get(FC + "/jars")).json()["files"] == []

    upload = flink_mock.post("/jars/upload").mock(
        return_value=httpx.Response(200, json={"filename": "/tmp/a.jar", "status": "success"})
    )
    resp = await api.post(FC + "/jars/upload", files={"file": ("a.jar", b"PK\x03\x04")})
    assert resp.json()["status"] == "success"
    assert b"a.jar" in upload.calls.last.request.content

    run = flink_mock.post("/jars/a.jar/run").mock(return_value=httpx.Response(200, json={"jobid": JID}))
    resp = await api.post(FC + "/jars/a.jar/run", json={"entryClass": "com.x.Main", "parallelism": 2})
    assert resp.json()["jobid"] == JID
    query = run.calls.last.request.url.query
    assert b"entry-class=com.x.Main" in query and b"parallelism=2" in query

    delete = flink_mock.delete("/jars/a.jar").mock(return_value=httpx.Response(200, json={}))
    assert (await api.delete(FC + "/jars/a.jar")).status_code == 204
    assert delete.called


async def test_sql_gateway_reports_unsupported_when_unconfigured(api, flink_mock):
    assert (await api.get(FC + "/sql")).json() == {
        "supported": False,
        "reason": "sqlGatewayUrl not configured",
    }
    resp = await api.post(FC + "/sql/sessions", json={"properties": {}})
    assert resp.json()["supported"] is False
    resp = await api.post(FC + "/sql/sessions/s1/statements", json={"statement": "SELECT 1"})
    assert resp.json()["supported"] is False
    assert (await api.get(FC + "/sql/sessions/s1/operations/o1/result")).json()["supported"] is False


async def test_sql_gateway_proxies_when_configured():
    from httpx import ASGITransport, AsyncClient

    settings = build_settings()
    settings.clusters[0].flink[0].sqlGatewayUrl = "http://gateway.test"
    app = build_app(settings)
    with respx.mock(assert_all_called=False) as mock:
        mock.get("http://gateway.test/v1/info").mock(
            return_value=httpx.Response(200, json={"productName": "Apache Flink", "version": "1.20.2"})
        )
        mock.post("http://gateway.test/v1/sessions").mock(
            return_value=httpx.Response(200, json={"sessionHandle": "sess-1"})
        )
        mock.post("http://gateway.test/v1/sessions/sess-1/statements").mock(
            return_value=httpx.Response(200, json={"operationHandle": "op-1"})
        )
        mock.get("http://gateway.test/v1/sessions/sess-1/operations/op-1/result/0").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultType": "PAYLOAD",
                    "results": {"columns": [{"name": "a"}], "data": [{"kind": "INSERT", "fields": [1]}]},
                },
            )
        )
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://itest") as client:
            info = (await client.get(FC + "/sql")).json()
            assert info["supported"] is True and info["info"]["version"] == "1.20.2"
            session = (await client.post(FC + "/sql/sessions", json={})).json()
            assert session["sessionHandle"] == "sess-1"
            op = (
                await client.post(FC + "/sql/sessions/sess-1/statements", json={"statement": "SELECT 1"})
            ).json()
            assert op["operationHandle"] == "op-1"
            result = (
                await client.get(FC + "/sql/sessions/sess-1/operations/op-1/result", params={"token": 0})
            ).json()
            assert result["resultType"] == "PAYLOAD"
    await app.state.registry.aclose()


async def test_missing_job_is_problem_json(api, flink_mock):
    flink_mock.get("/jobs/nope").mock(return_value=httpx.Response(404, json={"errors": ["not found"]}))
    resp = await api.get(f"{FC}/jobs/nope")
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("not-found")


async def test_unknown_flink_cluster_is_404(api, flink_mock):
    assert (await api.get(base("/flink/nope/overview"))).status_code == 404
