"""Alerting tests: CRUD, notifiers and the buffer/fire/resolve state machine."""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import respx

from k_shui.core.registry import ClusterRegistry
from k_shui.integrations.alerts import engine as engine_mod
from k_shui.integrations.alerts import notifiers, store
from k_shui.integrations.alerts.engine import AlertEngine, compare
from k_shui.integrations.alerts.evaluators import Measurement
from tests.conftest_integrations import CLUSTER, build_settings

pytest_plugins = ["tests.conftest_integrations"]

A = "/api/v1/alerts"


@pytest.fixture(autouse=True)
def memory_store(monkeypatch: pytest.MonkeyPatch):
    """Force the in-memory store so alert tests never depend on a database."""

    async def no_db() -> Any:
        return None

    monkeypatch.setattr(store, "_scope", no_db)
    store.reset_memory()
    yield
    store.reset_memory()


@pytest.fixture(autouse=True)
async def no_leaked_engine():
    """Never let a scheduler started by one test leak into the next."""
    yield
    await engine_mod.stop_alert_engine()


# --------------------------------------------------------------------- helpers


class FakeEvaluator:
    """Returns a scripted sequence of measurements, one per evaluation pass."""

    def __init__(self, values: list[float | None], target: str = "t1") -> None:
        self.values = list(values)
        self.target = target
        self.calls = 0

    async def __call__(self, ctx, component, metric, target):
        self.calls += 1
        value = self.values[min(self.calls - 1, len(self.values) - 1)]
        return [] if value == "gone" else [Measurement(self.target, value)]


class RecordingNotifier:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def __call__(self, action, alert, settings=None):
        self.sent.append({"action": action["id"], "status": alert["status"], "value": alert["value"]})
        return {"status": "sent", "actionId": action["id"]}


def make_engine(evaluator, notifier=None, clock=None):
    settings = build_settings()
    engine = AlertEngine(settings, ClusterRegistry(settings), evaluate_fn=evaluator, notify_fn=notifier)
    return engine


async def make_trigger(**overrides: Any) -> dict[str, Any]:
    payload = {
        "id": "trg1",
        "name": "URP",
        "clusterId": CLUSTER,
        "component": "cluster",
        "metric": "underReplicatedPartitions",
        "condition": "gt",
        "value": 0.0,
        "bufferSeconds": 0,
        "severity": "critical",
        "enabled": True,
        "actionIds": [],
    }
    payload.update(overrides)
    return await store.create_trigger(payload)


# ---------------------------------------------------------------- state machine


@pytest.mark.parametrize(
    ("value", "condition", "threshold", "expected"),
    [
        (2, "gt", 1, True),
        (1, "gt", 1, False),
        (1, "gte", 1, True),
        (0, "lt", 1, True),
        (1, "lte", 1, True),
        (1, "eq", 1, True),
        (2, "ne", 1, True),
        (1, "ne", 1, False),
        (1, "unknown", 1, False),
    ],
)
def test_compare(value, condition, threshold, expected):
    assert compare(value, condition, threshold) is expected


async def test_fires_immediately_without_buffer():
    await make_trigger()
    evaluator = FakeEvaluator([5.0])
    engine = make_engine(evaluator)
    result = await engine.run_once()
    assert result == {**result, "fired": 1, "resolved": 0, "evaluated": 1}
    history = await store.list_history()
    assert history["total"] == 1
    row = history["items"][0]
    assert row["status"] == "firing"
    assert row["value"] == 5.0
    assert row["threshold"] == 0.0
    assert row["severity"] == "critical"
    assert row["target"] == "t1"


async def test_buffer_delays_firing(monkeypatch):
    await make_trigger(bufferSeconds=60)
    evaluator = FakeEvaluator([5.0, 5.0, 5.0])
    engine = make_engine(evaluator)

    now = [1000.0]
    monkeypatch.setattr(engine_mod.time, "time", lambda: now[0])

    assert (await engine.run_once())["fired"] == 0
    assert (await store.list_history())["total"] == 0

    now[0] += 30  # still inside the buffer window
    assert (await engine.run_once())["fired"] == 0
    assert (await store.list_history())["total"] == 0

    now[0] += 31  # buffer elapsed → fire
    assert (await engine.run_once())["fired"] == 1
    assert (await store.list_history())["total"] == 1


async def test_buffer_resets_when_condition_clears(monkeypatch):
    await make_trigger(bufferSeconds=60)
    evaluator = FakeEvaluator([5.0, 0.0, 5.0, 5.0])
    engine = make_engine(evaluator)
    now = [1000.0]
    monkeypatch.setattr(engine_mod.time, "time", lambda: now[0])

    await engine.run_once()  # breach starts at t=1000
    now[0] += 30
    await engine.run_once()  # clears → buffer resets
    now[0] += 30
    await engine.run_once()  # breach restarts at t=1060
    now[0] += 30
    assert (await engine.run_once())["fired"] == 0  # only 30s into the new window
    assert (await store.list_history())["total"] == 0


async def test_resolve_closes_history_and_notifies():
    notifier = RecordingNotifier()
    action = await store.create_action(
        {"id": "act1", "name": "hook", "type": "webhook", "config": {"url": "http://x"}, "enabled": True}
    )
    await make_trigger(actionIds=[action["id"]])
    evaluator = FakeEvaluator([5.0, 0.0])
    engine = make_engine(evaluator, notifier)

    await engine.run_once()
    assert [s["status"] for s in notifier.sent] == ["firing"]

    result = await engine.run_once()
    assert result["resolved"] == 1
    assert [s["status"] for s in notifier.sent] == ["firing", "resolved"]

    row = (await store.list_history())["items"][0]
    assert row["status"] == "resolved"
    assert row["resolvedAt"] is not None
    assert row["notifications"][0]["status"] == "sent"


async def test_does_not_refire_while_already_firing():
    await make_trigger()
    engine = make_engine(FakeEvaluator([5.0, 6.0, 7.0]))
    fired = 0
    for _ in range(3):
        fired += (await engine.run_once())["fired"]
    assert fired == 1
    assert (await store.list_history())["total"] == 1


async def test_missing_data_holds_state():
    await make_trigger()
    engine = make_engine(FakeEvaluator([5.0, None, None]))
    await engine.run_once()
    for _ in range(2):
        result = await engine.run_once()
        assert result["fired"] == 0 and result["resolved"] == 0
    assert (await store.list_history())["items"][0]["status"] == "firing"


async def test_vanished_target_resolves():
    await make_trigger()
    engine = make_engine(FakeEvaluator([5.0, "gone"]))
    await engine.run_once()
    assert (await engine.run_once())["resolved"] == 1
    assert (await store.list_history())["items"][0]["status"] == "resolved"


async def test_disabled_triggers_are_skipped():
    await make_trigger(enabled=False)
    engine = make_engine(FakeEvaluator([5.0]))
    assert (await engine.run_once())["evaluated"] == 0


async def test_notifier_failure_is_recorded_not_raised():
    async def failing(action, alert, settings=None):
        raise RuntimeError("smtp down")

    action = await store.create_action({"id": "act1", "name": "mail", "type": "email", "config": {}})
    await make_trigger(actionIds=[action["id"]])
    engine = make_engine(FakeEvaluator([5.0]), failing)
    assert (await engine.run_once())["fired"] == 1
    row = (await store.list_history())["items"][0]
    assert row["notifications"][0]["status"] == "failed"
    assert "smtp down" in row["notifications"][0]["error"]


async def test_engine_status_and_gauge_sync():
    await make_trigger()
    engine = make_engine(FakeEvaluator([5.0]))
    await engine.run_once()
    status = engine.status()
    assert status["runs"] == 1 and status["trackedTargets"] == 1
    gauge = engine_mod._gauge()
    if gauge is not None:
        assert gauge.labels(severity="critical")._value.get() == 1.0


# ------------------------------------------------------------------- notifiers


async def test_slack_notifier_sends_blocks():
    alert = {
        "triggerName": "URP",
        "status": "firing",
        "severity": "critical",
        "clusterId": "c",
        "target": "t",
        "metric": "m",
        "value": 5,
        "threshold": 0,
    }
    with respx.mock as mock:
        route = mock.post("http://hooks.slack/x").mock(return_value=httpx.Response(200, text="ok"))
        result = await notifiers.send(
            {"id": "a", "type": "slack", "config": {"webhookUrl": "http://hooks.slack/x"}}, alert
        )
    assert result["status"] == "sent"
    body = json.loads(route.calls.last.request.content)
    assert body["blocks"][0]["type"] == "header"
    assert "URP" in body["blocks"][0]["text"]["text"]
    assert any("critical" in f["text"] for f in body["blocks"][1]["fields"])


async def test_pagerduty_trigger_and_resolve_share_dedup_key():
    base_alert = {
        "triggerId": "t1",
        "clusterId": "c",
        "target": "x",
        "triggerName": "n",
        "severity": "warning",
        "component": "cluster",
        "metric": "m",
        "value": 1,
        "threshold": 0,
    }
    action = {"id": "a", "type": "pagerduty", "config": {"routingKey": "R1"}}
    with respx.mock as mock:
        route = mock.post("https://events.pagerduty.com/v2/enqueue").mock(
            return_value=httpx.Response(202, json={"status": "success"})
        )
        await notifiers.send(action, {**base_alert, "status": "firing"})
        await notifiers.send(action, {**base_alert, "status": "resolved"})
    calls = [json.loads(c.request.content) for c in route.calls]
    assert [c["event_action"] for c in calls] == ["trigger", "resolve"]
    assert calls[0]["dedup_key"] == calls[1]["dedup_key"]
    assert calls[0]["payload"]["severity"] == "warning"
    assert "payload" not in calls[1]


async def test_webhook_template_is_rendered():
    action = {
        "id": "a",
        "type": "webhook",
        "config": {
            "url": "http://hook.test/in",
            "template": '{"text": "{{ triggerName }} is {{ status }}", "v": {{ value }}}',
            "headers": {"X-Token": "secret"},
        },
    }
    with respx.mock as mock:
        route = mock.post("http://hook.test/in").mock(return_value=httpx.Response(200))
        result = await notifiers.send(action, {"triggerName": "URP", "status": "firing", "value": 3})
    assert result["status"] == "sent"
    request = route.calls.last.request
    assert request.headers["X-Token"] == "secret"
    assert json.loads(request.content) == {"text": "URP is firing", "v": 3}


async def test_teams_notifier():
    with respx.mock as mock:
        route = mock.post("http://teams.test/hook").mock(return_value=httpx.Response(200))
        result = await notifiers.send(
            {"id": "a", "type": "teams", "config": {"webhookUrl": "http://teams.test/hook"}},
            {
                "triggerName": "URP",
                "status": "firing",
                "severity": "info",
                "component": "cluster",
                "target": "t",
                "metric": "m",
                "value": 1,
                "threshold": 0,
                "clusterId": "c",
            },
        )
    assert result["status"] == "sent"
    body = json.loads(route.calls.last.request.content)
    assert body["@type"] == "MessageCard"
    assert any(f["name"] == "Severity" for f in body["sections"][0]["facts"])


async def test_webhook_failure_is_reported():
    with respx.mock as mock:
        mock.post("http://hook.test/in").mock(return_value=httpx.Response(500, text="nope"))
        result = await notifiers.send(
            {"id": "a", "type": "webhook", "config": {"url": "http://hook.test/in"}}, {"status": "firing"}
        )
    assert result["status"] == "failed" and result["httpStatus"] == 500


async def test_unknown_action_type():
    result = await notifiers.send({"id": "a", "type": "carrier-pigeon", "config": {}}, {})
    assert result["status"] == "failed"
    assert "unknown action type" in result["error"]


async def test_email_requires_smtp_and_recipients():
    result = await notifiers.send({"id": "a", "type": "email", "config": {"to": ["x@y.z"]}}, {})
    assert result["status"] == "failed"
    assert "smtp.host" in result["error"]


# ----------------------------------------------------------------------- API


async def test_trigger_crud_and_enable_disable(api):
    payload = {
        "name": "Consumer lag",
        "clusterId": CLUSTER,
        "component": "consumerGroup",
        "target": {"regex": "^orders-.*"},
        "metric": "lag",
        "condition": "gt",
        "value": 1000,
        "bufferSeconds": 120,
        "severity": "warning",
    }
    created = await api.post(A + "/triggers", json=payload)
    assert created.status_code == 201
    trigger = created.json()
    assert trigger["target"] == {"regex": "^orders-.*"}
    assert trigger["bufferSeconds"] == 120

    assert [t["id"] for t in (await api.get(A + "/triggers")).json()] == [trigger["id"]]
    assert (await api.get(f"{A}/triggers/{trigger['id']}")).json()["name"] == "Consumer lag"

    updated = await api.put(f"{A}/triggers/{trigger['id']}", json={"value": 5000})
    assert updated.json()["value"] == 5000

    assert (await api.post(f"{A}/triggers/{trigger['id']}/disable")).json()["enabled"] is False
    assert (await api.post(f"{A}/triggers/{trigger['id']}/enable")).json()["enabled"] is True
    assert [t["id"] for t in (await api.get(A + "/triggers", params={"enabled": True})).json()]

    assert (await api.delete(f"{A}/triggers/{trigger['id']}")).status_code == 204
    assert (await api.get(f"{A}/triggers/{trigger['id']}")).status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "x", "component": "cluster", "metric": "nope"},
        {"name": "x", "component": "cluster", "metric": "lag", "clusterId": "unknown"},
    ],
)
async def test_trigger_validation(api, payload):
    resp = await api.post(A + "/triggers", json=payload)
    assert resp.status_code == 400
    assert resp.json()["type"].endswith("bad-request")


async def test_unknown_component_is_rejected_by_schema(api):
    resp = await api.post(A + "/triggers", json={"name": "x", "component": "toaster", "metric": "m"})
    assert resp.status_code == 422


async def test_action_crud_and_test(api):
    created = await api.post(
        A + "/actions",
        json={"name": "ops", "type": "webhook", "config": {"url": "http://hook.test/in"}},
    )
    assert created.status_code == 201
    action = created.json()
    assert (await api.get(A + "/actions")).json()[0]["id"] == action["id"]
    assert (await api.get(f"{A}/actions/{action['id']}")).json()["type"] == "webhook"

    renamed = await api.put(f"{A}/actions/{action['id']}", json={"name": "ops2"})
    assert renamed.json()["name"] == "ops2"

    with respx.mock as mock:
        route = mock.post("http://hook.test/in").mock(return_value=httpx.Response(204))
        result = (await api.post(f"{A}/actions/{action['id']}/test")).json()
    assert result["status"] == "sent"
    assert json.loads(route.calls.last.request.content)["triggerName"] == "k-shui test notification"

    assert (await api.delete(f"{A}/actions/{action['id']}")).status_code == 204
    assert (await api.get(f"{A}/actions/{action['id']}")).status_code == 404


async def test_history_filters_ack_and_summary(api):
    await store.create_history(
        {
            "id": "h1",
            "triggerId": "t1",
            "triggerName": "A",
            "component": "cluster",
            "clusterId": CLUSTER,
            "severity": "critical",
            "status": "firing",
            "value": 3,
            "threshold": 1,
            "target": "x",
        }
    )
    await store.create_history(
        {
            "id": "h2",
            "triggerId": "t2",
            "triggerName": "B",
            "component": "connector",
            "clusterId": CLUSTER,
            "severity": "warning",
            "status": "resolved",
            "value": 0,
            "threshold": 1,
            "target": "y",
        }
    )

    page = (await api.get(A + "/history")).json()
    assert page["total"] == 2 and page["page"] == 1 and page["perPage"] == 50

    firing = (await api.get(A + "/history", params={"status": "firing"})).json()
    assert [i["id"] for i in firing["items"]] == ["h1"]

    by_component = (await api.get(A + "/history", params={"component": "connector"})).json()
    assert [i["id"] for i in by_component["items"]] == ["h2"]

    acked = (await api.post(A + "/history/h1/ack")).json()
    assert acked["ackedAt"] is not None

    summary = (await api.get(A + "/summary")).json()
    assert summary["firing"] == 1
    assert summary["bySeverity"]["critical"] == 1
    assert summary["unacknowledged"] == 0


async def test_metric_catalog_endpoint(api):
    rows = (await api.get(A + "/metrics")).json()
    components = {r["component"] for r in rows}
    assert {
        "cluster",
        "broker",
        "topic",
        "consumerGroup",
        "connector",
        "ksqlQuery",
        "flinkJob",
        "custom",
    } <= components
    cluster = next(r for r in rows if r["component"] == "cluster")
    names = {m["name"] for m in cluster["metrics"]}
    assert {
        "underReplicatedPartitions",
        "offlinePartitions",
        "activeControllerCount",
        "zkOrKraftUnavailable",
        "brokerDownCount",
        "bytesIn",
        "bytesOut",
    } <= names
    assert all({"unit", "description", "source"} <= set(m) for m in cluster["metrics"])


async def test_alerts_api_lazily_starts_the_engine(api, integration_app):
    assert integration_app.state.alert_engine is None
    await api.get(A + "/triggers")
    engine = integration_app.state.alert_engine
    assert engine is not None and engine.running
    assert (await api.get(A + "/status")).json()["running"] is True


async def test_evaluate_endpoint_runs_a_pass(api, integration_app):
    body = (await api.post(A + "/evaluate")).json()
    assert set(body) >= {"evaluated", "fired", "resolved"}
    assert integration_app.state.alert_engine.running is True


# --------------------------------------------------------------- `since` filter


async def test_history_since_accepts_relative_durations(api):
    """The UI sends `24h`/`7d`/`all`; older clients send a raw epoch. All must work."""
    await store.create_history(
        {
            "id": "old",
            "triggerId": "t1",
            "triggerName": "A",
            "component": "cluster",
            "clusterId": CLUSTER,
            "severity": "warning",
            "status": "firing",
            "value": 1,
            "threshold": 0,
            "target": "x",
            "firedAt": datetime.fromtimestamp(time.time() - 10 * 86400, UTC).isoformat(),
        }
    )
    await store.create_history(
        {
            "id": "recent",
            "triggerId": "t1",
            "triggerName": "A",
            "component": "cluster",
            "clusterId": CLUSTER,
            "severity": "warning",
            "status": "firing",
            "value": 1,
            "threshold": 0,
            "target": "y",
        }
    )

    # a 7d window hides the 10-day-old row
    week = await api.get(A + "/history", params={"since": "7d"})
    assert week.status_code == 200
    assert [i["id"] for i in week.json()["items"]] == ["recent"]

    # `all` and an omitted value mean "no filter"
    for params in ({"since": "all"}, {}):
        assert (await api.get(A + "/history", params=params)).json()["total"] == 2

    # a raw epoch cutoff still works
    epoch = await api.get(A + "/history", params={"since": time.time() - 86400})
    assert [i["id"] for i in epoch.json()["items"]] == ["recent"]


async def test_history_since_rejects_garbage(api):
    resp = await api.get(A + "/history", params={"since": "last-tuesday"})
    assert resp.status_code == 400
    assert resp.json()["type"].endswith("bad-request")


# ------------------------------------------------- consumer-group lag evaluation


async def test_consumer_group_lag_uses_watermarks(ctx):
    """Regression: `group_offsets` reports committed offsets only and carries no
    `lag` key, so lag must be derived from the end offsets. Reading a non-existent
    `lag` field made every measurement 0 and lag alerts could never fire."""
    from k_shui.integrations.alerts.evaluators import eval_consumer_group

    # fake cluster: group `app-consumers` committed 90 on orders-0, which ends at 100
    measurements = await eval_consumer_group(ctx, "lag", {"name": "app-consumers"})
    assert [(m.target, m.value) for m in measurements] == [("app-consumers", 10.0)]

    per_partition = await eval_consumer_group(ctx, "lagPerPartition", {"name": "app-consumers"})
    assert per_partition[0].value == 10.0


async def test_consumer_group_lag_target_filter(ctx):
    from k_shui.integrations.alerts.evaluators import eval_consumer_group

    assert await eval_consumer_group(ctx, "lag", {"name": "nope"}) == []
    assert [m.target for m in await eval_consumer_group(ctx, "lag", None)] == ["app-consumers"]
