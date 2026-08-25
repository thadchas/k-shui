"""Partition remediation: reassignment planning, leader elections and the 501 degradation paths."""

from __future__ import annotations

from concurrent.futures import Future
from typing import Any

import pytest
from httpx import AsyncClient

from k_shui.core.errors import BadRequest
from k_shui.kafka.partitions import (
    BrokerInfo,
    plan_reassignment,
    rack_interleave,
    reassign_command,
    reassignment_json,
)
from tests.fakes import FakeKafkaAdmin

C = "/api/v1/clusters/test"
P = f"{C}/partitions"


# ------------------------------------------------------------------ planner (pure)
def _counts(items: Any, key: str = "proposed") -> tuple[dict[int, int], dict[int, int]]:
    replicas: dict[int, int] = {}
    leaders: dict[int, int] = {}
    for it in items:
        for b in getattr(it, key):
            replicas[b] = replicas.get(b, 0) + 1
        first = getattr(it, key)[0]
        leaders[first] = leaders.get(first, 0) + 1
    return replicas, leaders


def test_plan_is_balanced_and_preserves_rf() -> None:
    brokers = [BrokerInfo(0), BrokerInfo(1), BrokerInfo(2)]
    current = {"t": {p: [0, 1] for p in range(6)}}  # everything on 0/1, broker 2 empty
    plan = plan_reassignment(current, brokers)
    assert not plan.rack_aware
    assert [len(i.proposed) for i in plan.items] == [2] * 6
    assert all(len(set(i.proposed)) == 2 for i in plan.items)
    replicas, leaders = _counts(plan.items)
    assert replicas == {0: 4, 1: 4, 2: 4}
    assert leaders == {0: 2, 1: 2, 2: 2}
    assert plan.changed and len(plan.changed) < 6  # partitions already matching stay untouched


def test_plan_rotates_leaders_across_topics() -> None:
    brokers = [BrokerInfo(0), BrokerInfo(1), BrokerInfo(2)]
    current = {"a": {0: [0]}, "b": {0: [0]}, "c": {0: [0]}}
    plan = plan_reassignment(current, brokers)
    assert sorted(i.proposed[0] for i in plan.items) == [0, 1, 2]


def test_plan_is_rack_aware() -> None:
    brokers = [BrokerInfo(0, "a"), BrokerInfo(1, "a"), BrokerInfo(2, "b"), BrokerInfo(3, "b")]
    assert [b.id for b in rack_interleave(brokers)] == [0, 2, 1, 3]
    current = {"t": {p: [0, 1] for p in range(8)}}
    plan = plan_reassignment(current, brokers)
    assert plan.rack_aware
    rack = {b.id: b.rack for b in brokers}
    for item in plan.items:
        assert {rack[r] for r in item.proposed} == {"a", "b"}
    replicas, _ = _counts(plan.items)
    assert replicas == {0: 4, 1: 4, 2: 4, 3: 4}


def test_plan_respects_target_brokers_and_validates() -> None:
    brokers = [BrokerInfo(0), BrokerInfo(1), BrokerInfo(2)]
    plan = plan_reassignment({"t": {0: [0], 1: [0]}}, brokers, target_brokers=[1, 2])
    assert plan.brokers == [1, 2]
    assert all(set(i.proposed) <= {1, 2} for i in plan.items)
    with pytest.raises(BadRequest):
        plan_reassignment({"t": {0: [0]}}, brokers, target_brokers=[9])
    with pytest.raises(BadRequest):
        plan_reassignment({"t": {0: [0, 1, 2]}}, brokers, target_brokers=[0, 1])
    with pytest.raises(BadRequest):
        plan_reassignment({"t": {0: [0]}}, [])


def test_reassignment_json_and_command() -> None:
    body = reassignment_json([{"topic": "t", "partition": 1, "replicas": [2, 0]}])
    assert body == {"version": 1, "partitions": [{"topic": "t", "partition": 1, "replicas": [2, 0]}]}
    cmd = reassign_command("b:9092", 1000)
    assert cmd.startswith("kafka-reassign-partitions.sh --bootstrap-server b:9092")
    assert "--throttle 1000" in cmd and cmd.endswith("--execute")


# ------------------------------------------------------------------ router (fake raw client)
class RawClient:
    """Stand-in for ``confluent_kafka.admin.AdminClient`` exposing only ``elect_leaders``."""

    def __init__(self, result: dict[Any, Any] | None = None) -> None:
        self.result = result
        self.calls: list[tuple[Any, Any]] = []

    def elect_leaders(self, election_type: Any, partitions: Any = None, **_: Any) -> Future[Any]:
        from confluent_kafka import KafkaError, KafkaException, TopicPartition

        self.calls.append((election_type, partitions))
        fut: Future[Any] = Future()
        if self.result is not None:
            fut.set_result(self.result)
        else:
            targets = partitions or [TopicPartition("orders", 0), TopicPartition("orders", 1)]
            out: dict[Any, Any] = {}
            for i, tp in enumerate(targets):
                out[tp] = None if i == 0 else KafkaException(KafkaError(KafkaError.ELECTION_NOT_NEEDED))
            fut.set_result(out)
        return fut


class RawClientWithoutElections:
    pass


@pytest.fixture
def raw(monkeypatch: pytest.MonkeyPatch) -> RawClient:
    client = RawClient()
    monkeypatch.setattr(FakeKafkaAdmin, "admin", property(lambda self: client), raising=False)
    return client


async def test_capabilities_report_client_support(client: AsyncClient, raw: RawClient) -> None:
    body = (await client.get(f"{P}/capabilities")).json()
    assert body["electLeaders"] is True
    assert body["reassign"] is False and body["listReassignments"] is False
    assert body["clientVersion"]


async def test_elect_preferred_leaders_for_selected_partitions(client: AsyncClient, raw: RawClient) -> None:
    from confluent_kafka import ElectionType

    resp = await client.post(
        f"{P}/elect-leaders",
        json={"partitions": [{"topic": "orders", "partition": 0}, {"topic": "orders", "partition": 2}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["electionType"] == "preferred"
    assert body["succeeded"] == 1 and body["notNeeded"] == 1 and body["failed"] == 0
    assert [(i["partition"], i["status"]) for i in body["items"]] == [(0, "elected"), (2, "notNeeded")]
    assert "not needed" in body["items"][1]["error"].lower()
    etype, targets = raw.calls[0]
    assert etype == ElectionType.PREFERRED
    assert [(t.topic, t.partition) for t in targets] == [("orders", 0), ("orders", 2)]

    audit = (await client.get("/api/v1/audit")).json()["items"]
    assert audit[0]["action"] == "partitions.elect_leaders"
    assert audit[0]["resource"] == "orders-0,orders-2"
    assert audit[0]["details"]["electionType"] == "preferred"


async def test_elect_all_partitions_unclean(client: AsyncClient, raw: RawClient) -> None:
    from confluent_kafka import ElectionType

    resp = await client.post(f"{P}/elect-leaders", json={"electionType": "unclean"})
    assert resp.status_code == 200
    assert raw.calls[0] == (ElectionType.UNCLEAN, None)
    audit = (await client.get("/api/v1/audit")).json()["items"]
    assert audit[0]["resource"] == "*" and audit[0]["details"]["partitions"] == "all"


async def test_elect_validation(client: AsyncClient, raw: RawClient) -> None:
    resp = await client.post(f"{P}/elect-leaders", json={"partitions": [{"topic": "nope", "partition": 0}]})
    assert resp.status_code == 404
    resp = await client.post(f"{P}/elect-leaders", json={"partitions": [{"topic": "orders", "partition": 9}]})
    assert resp.status_code == 404
    resp = await client.post(f"{P}/elect-leaders", json={"electionType": "random"})
    assert resp.status_code == 422
    assert not raw.calls


async def test_elect_501_when_client_lacks_api(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        FakeKafkaAdmin, "admin", property(lambda self: RawClientWithoutElections()), raising=False
    )
    resp = await client.post(f"{P}/elect-leaders", json={})
    assert resp.status_code == 501
    body = resp.json()
    assert body["type"].endswith("unsupported-feature")
    assert "elect_leaders" in body["detail"]


async def test_reassignments_degrade_when_unsupported(client: AsyncClient, raw: RawClient) -> None:
    body = (await client.get(f"{P}/reassignments")).json()
    assert body == {"supported": False, "reason": body["reason"], "items": []}
    assert "list_partition_reassignments" in body["reason"]


async def test_reassign_plan_endpoint(client: AsyncClient, raw: RawClient) -> None:
    resp = await client.post(f"{P}/reassign/plan", json={"topics": ["orders"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {i["topic"] for i in body["items"]} == {"orders"}
    assert len(body["items"]) == 3
    assert body["applySupported"] is False
    assert body["brokers"] == [0, 1]
    # fake brokers: 0 in rack-a, 1 without a rack → rack-aware interleave across the two lanes
    assert body["rackAware"] is True
    assert body["reassignmentJson"]["version"] == 1
    assert len(body["reassignmentJson"]["partitions"]) == body["changed"]
    assert "kafka-reassign-partitions.sh" in body["command"]

    everything = (await client.post(f"{P}/reassign/plan", json={})).json()
    assert {i["topic"] for i in everything["items"]} >= {"orders", "events"}
    assert (await client.post(f"{P}/reassign/plan", json={"topics": ["missing"]})).status_code == 404
    assert (await client.post(f"{P}/reassign/plan", json={"brokers": [7]})).status_code == 400


async def test_reassign_returns_501_with_cli_payload(client: AsyncClient, raw: RawClient) -> None:
    resp = await client.post(
        f"{P}/reassign",
        json={
            "partitions": [{"topic": "orders", "partition": 0, "replicas": [1, 0]}],
            "throttleBytesPerSec": 5000,
        },
    )
    assert resp.status_code == 501, resp.text
    body = resp.json()
    assert "alter_partition_reassignments" in body["detail"]
    assert body["reassignmentJson"] == {
        "version": 1,
        "partitions": [{"topic": "orders", "partition": 0, "replicas": [1, 0]}],
    }
    assert "--throttle 5000" in body["command"]


async def test_reassign_request_validation(client: AsyncClient, raw: RawClient) -> None:
    assert (await client.post(f"{P}/reassign", json={"partitions": []})).status_code == 422
    dup = {"partitions": [{"topic": "orders", "partition": 0, "replicas": [1, 1]}]}
    resp = await client.post(f"{P}/reassign", json=dup)
    assert resp.status_code == 400 and "duplicate" in resp.json()["detail"]
    negative = {"partitions": [{"topic": "orders", "partition": 0, "replicas": [-1]}]}
    assert (await client.post(f"{P}/reassign", json=negative)).status_code == 422
    empty = {"partitions": [{"topic": "orders", "partition": 0, "replicas": []}]}
    assert (await client.post(f"{P}/reassign", json=empty)).status_code == 422
    missing = {"partitions": [{"topic": "orders", "partition": 42, "replicas": [0]}]}
    assert (await client.post(f"{P}/reassign", json=missing)).status_code == 404
    unknown_broker = {"partitions": [{"topic": "orders", "partition": 0, "replicas": [0, 9]}]}
    resp = await client.post(f"{P}/reassign", json=unknown_broker)
    assert resp.status_code == 400 and "9" in resp.json()["detail"]
    bad_throttle = {
        "partitions": [{"topic": "orders", "partition": 0, "replicas": [0]}],
        "throttleBytesPerSec": 0,
    }
    assert (await client.post(f"{P}/reassign", json=bad_throttle)).status_code == 422


async def test_mutations_require_editor(basic_auth_client: AsyncClient, raw: RawClient) -> None:
    login = await basic_auth_client.post("/api/v1/auth/login", json={"username": "vi", "password": "vipw"})
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    resp = await basic_auth_client.post(f"{P}/elect-leaders", json={}, headers=headers)
    assert resp.status_code == 403
    resp = await basic_auth_client.post(f"{P}/reassign/plan", json={}, headers=headers)
    assert resp.status_code == 200
