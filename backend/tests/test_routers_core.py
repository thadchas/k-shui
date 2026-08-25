"""Happy path + 404 coverage for the core routers."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

C = "/api/v1/clusters/test"
MISSING = "/api/v1/clusters/nope"


async def test_healthz_readyz_metrics_and_root(client: AsyncClient) -> None:
    assert (await client.get("/healthz")).json()["status"] == "ok"

    ready = await client.get("/readyz")
    assert ready.status_code == 200
    body = ready.json()
    assert body["clustersTotal"] == 1
    assert body["database"] is True

    metrics = await client.get("/metrics")
    assert metrics.status_code == 200
    assert "kshui_clusters_online" in metrics.text

    root = await client.get("/")
    assert root.status_code == 200
    if root.headers["content-type"].startswith("application/json"):
        assert root.json()["docs"] == "/docs"  # no bundle: JSON pointer to the docs
    else:
        assert "<html" in root.text.lower()  # SPA bundle present


async def test_system_info(client: AsyncClient) -> None:
    body = (await client.get("/api/v1/info")).json()
    assert body["version"]
    assert body["auth"] == {
        "type": "none",
        "enabled": False,
        "user": {"username": "anonymous", "role": "admin", "clusters": None, "anonymous": True},
    }
    assert body["clusters"] == [{"id": "test", "name": "Test cluster"}]
    assert body["uptimeSeconds"] >= 0


async def test_clusters_list_and_detail(client: AsyncClient) -> None:
    items = (await client.get("/api/v1/clusters")).json()
    assert len(items) == 1
    assert items[0]["id"] == "test"
    assert items[0]["status"] == "online"
    assert items[0]["brokerCount"] == 2
    assert items[0]["topicCount"] == 3

    detail = (await client.get(C)).json()
    assert detail["clusterId"] == "fake-cluster-id"
    assert detail["bootstrapServers"] == "fake:9092"
    assert detail["kraft"]["leaderId"] == 0
    assert detail["version"] == "3.9"


async def test_cluster_404(client: AsyncClient) -> None:
    resp = await client.get(MISSING)
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("http-error")


async def test_cluster_health_and_overview_metrics(client: AsyncClient) -> None:
    health = (await client.get(f"{C}/health")).json()
    assert health["status"] == "ok"
    assert {c["name"] for c in health["checks"]} >= {
        "kafka",
        "underReplicatedPartitions",
        "offlinePartitions",
    }

    metrics = (await client.get(f"{C}/overview/metrics?range=1h")).json()
    assert metrics["source"] == "sampled"
    assert {s["name"] for s in metrics["series"]} == {
        "messagesIn",
        "bytesIn",
        "bytesOut",
        "requestRate",
        "activeControllers",
        "underReplicated",
        "offlinePartitions",
    }


async def test_brokers(client: AsyncClient) -> None:
    brokers = (await client.get(f"{C}/brokers")).json()
    assert [b["id"] for b in brokers] == [0, 1]
    assert brokers[0]["isController"] is True
    assert brokers[0]["logDirSizeBytes"] == 1024
    assert brokers[0]["logDirTotalBytes"] == 10240
    assert brokers[0]["logDirUsableBytes"] == 5120

    one = (await client.get(f"{C}/brokers/0")).json()
    assert one["host"] == "broker-0"
    assert (await client.get(f"{C}/brokers/99")).status_code == 404

    configs = (await client.get(f"{C}/brokers/0/configs")).json()
    assert {c["name"] for c in configs} == {"log.dirs", "num.io.threads"}

    logdirs = (await client.get(f"{C}/brokers/0/logdirs")).json()
    assert logdirs[0]["path"] == "/var/lib/kafka"
    assert logdirs[0]["totalBytes"] == 10240
    assert logdirs[0]["usableBytes"] == 5120
    assert logdirs[0]["error"] is None

    series = (await client.get(f"{C}/brokers/0/metrics?range=6h")).json()["series"]
    assert {s["name"] for s in series} >= {"bytesIn", "bytesOut"}


async def test_broker_configs_update(client: AsyncClient, admin: Any) -> None:
    resp = await client.put(f"{C}/brokers/0/configs", json={"configs": {"num.io.threads": "16"}})
    assert resp.status_code == 200
    assert "alter_configs:broker:0" in admin.calls


async def test_topics_list_pagination_search_and_internal(client: AsyncClient) -> None:
    page = (await client.get(f"{C}/topics?perPage=1")).json()
    assert page["total"] == 2  # internal hidden by default
    assert page["perPage"] == 1
    assert len(page["items"]) == 1

    with_internal = (await client.get(f"{C}/topics?showInternal=true")).json()
    assert with_internal["total"] == 3

    found = (await client.get(f"{C}/topics?search=ord")).json()
    assert [t["name"] for t in found["items"]] == ["orders"]
    orders = found["items"][0]
    assert orders["partitions"] == 3
    assert orders["messageCount"] == 300  # 3 partitions x (100 - 0)
    assert orders["cleanupPolicy"] == "delete"
    assert orders["retentionMs"] == 604800000
    assert orders["hasSchema"] == {"key": False, "value": False}


async def test_topics_sorting(client: AsyncClient) -> None:
    desc = (await client.get(f"{C}/topics?sort=name&order=desc")).json()
    assert [t["name"] for t in desc["items"]] == ["orders", "events"]


async def test_topic_detail_and_404(client: AsyncClient) -> None:
    detail = (await client.get(f"{C}/topics/orders")).json()
    assert detail["messageCount"] == 300
    assert len(detail["partitionsDetail"]) == 3
    assert detail["partitionsDetail"][0]["endOffset"] == 100

    resp = await client.get(f"{C}/topics/ghost")
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("not-found")


async def test_topic_lifecycle(client: AsyncClient, admin: Any) -> None:
    created = await client.post(
        f"{C}/topics", json={"name": "new-topic", "partitions": 2, "replicationFactor": 1}
    )
    assert created.status_code == 201
    assert created.json()["name"] == "new-topic"

    conflict = await client.post(f"{C}/topics", json={"name": "new-topic", "partitions": 1})
    assert conflict.status_code == 409

    grown = await client.post(f"{C}/topics/new-topic/partitions", json={"count": 4})
    assert grown.json()["partitions"] == 4

    cfg = await client.put(f"{C}/topics/new-topic/configs", json={"configs": {"retention.ms": "1000"}})
    assert any(c["name"] == "retention.ms" and c["value"] == "1000" for c in cfg.json())

    cloned = await client.post(f"{C}/topics/new-topic/clone", json={"name": "new-topic-copy"})
    assert cloned.status_code == 201

    purged = await client.post(f"{C}/topics/new-topic/purge")
    assert len(purged.json()["partitions"]) == 4

    deleted = await client.delete(f"{C}/topics/new-topic")
    assert deleted.json()["ok"] is True
    assert "delete_topic:new-topic" in admin.calls
    assert (await client.get(f"{C}/topics/new-topic")).status_code == 404


async def test_topic_configs_consumers_schema_metrics(client: AsyncClient) -> None:
    configs = (await client.get(f"{C}/topics/orders/configs")).json()
    assert {c["name"] for c in configs} == {"cleanup.policy", "retention.ms"}

    consumers = (await client.get(f"{C}/topics/orders/consumers")).json()
    assert consumers[0]["groupId"] == "app-consumers"
    assert consumers[0]["lag"] == 10  # end 100 - committed 90

    schema = (await client.get(f"{C}/topics/orders/schema")).json()
    assert schema == {"key": None, "value": None, "strategy": "topic"}

    series = (await client.get(f"{C}/topics/orders/metrics?range=1h")).json()["series"]
    assert {s["name"] for s in series} == {"messagesIn", "bytesIn", "bytesOut", "size"}


async def test_messages_json_and_stream(client: AsyncClient) -> None:
    body = (await client.get(f"{C}/topics/orders/messages?stream=false&limit=3")).json()
    assert len(body["items"]) == 3
    assert body["items"][0]["valueFormat"] == "json"
    assert body["scanned"] == 3

    streamed = await client.get(f"{C}/topics/orders/messages?limit=2")
    assert streamed.headers["content-type"].startswith("text/event-stream")
    assert "event: message" in streamed.text
    assert "event: end" in streamed.text


async def test_messages_bad_params(client: AsyncClient) -> None:
    assert (await client.get(f"{C}/topics/orders/messages?mode=sideways")).status_code == 422
    assert (await client.get(f"{C}/topics/orders/messages?partitions=a,b&stream=false")).status_code == 400


async def test_messages_start_offsets_param(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.fakes import FakeMessageBrowser

    seen: list[Any] = []
    original = FakeMessageBrowser.collect

    async def spy(self: Any, req: Any) -> dict[str, Any]:
        seen.append(req)
        return await original(self, req)

    monkeypatch.setattr(FakeMessageBrowser, "collect", spy)
    resp = await client.get(
        f"{C}/topics/orders/messages?mode=offset&offset=5&startOffsets=0:10,%201:20&stream=false&limit=2"
    )
    assert resp.status_code == 200
    assert seen[-1].start_offsets == {0: 10, 1: 20}
    assert seen[-1].offset == 5

    for bad in ("0:x", "0:-1", "nope"):
        r = await client.get(f"{C}/topics/orders/messages?mode=offset&startOffsets={bad}&stream=false")
        assert r.status_code == 400, bad


async def test_messages_tail_and_filter_target_params(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.fakes import FakeMessageBrowser

    seen: list[Any] = []
    original = FakeMessageBrowser.browse

    def spy(self: Any, req: Any) -> Any:
        seen.append(req)
        return original(self, req)

    monkeypatch.setattr(FakeMessageBrowser, "browse", spy)
    resp = await client.get(
        f"{C}/topics/orders/messages?mode=tail&filter=header:trace%3Dt1&filterTarget=key&limit=5"
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "event: progress" in resp.text
    assert seen[-1].mode == "tail" and seen[-1].tail is True
    assert seen[-1].filter == "header:trace=t1"
    assert seen[-1].filter_target == "key"

    assert (await client.get(f"{C}/topics/orders/messages?filterTarget=everything")).status_code == 422
    assert (await client.get(f"{C}/topics/orders/messages?mode=follow")).status_code == 422


async def test_purge_specific_partitions(client: AsyncClient, admin: Any) -> None:
    resp = await client.post(
        f"{C}/topics/orders/purge",
        json={"partitions": [{"id": 1, "beforeOffset": 40}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [p["partition"] for p in body["partitions"]] == [1]
    assert body["partitions"][0]["lowWatermark"] == 40
    assert admin.topics["orders"].partitions[1].begin == 40
    assert admin.topics["orders"].partitions[0].begin == 0  # untouched


async def test_message_export_formats(client: AsyncClient) -> None:
    csv_resp = await client.get(f"{C}/topics/orders/messages/export?format=csv&limit=2")
    assert csv_resp.headers["content-type"].startswith("text/csv")
    assert csv_resp.text.splitlines()[0] == "partition,offset,timestamp,key,value,headers"

    nd = await client.get(f"{C}/topics/orders/messages/export?format=ndjson&limit=2")
    assert nd.headers["content-type"].startswith("application/x-ndjson")
    assert len(nd.text.strip().splitlines()) == 2


async def test_produce_message(client: AsyncClient) -> None:
    resp = await client.post(
        f"{C}/topics/orders/messages",
        json={"key": "k", "value": {"a": 1}, "headers": {"h": "v"}, "partition": 1},
    )
    assert resp.status_code == 201
    assert resp.json()["partition"] == 1


async def test_consumer_groups_list_detail_and_404(client: AsyncClient) -> None:
    groups = (await client.get(f"{C}/consumer-groups")).json()
    assert len(groups) == 1
    assert groups[0]["groupId"] == "app-consumers"
    assert groups[0]["totalLag"] == 10
    assert groups[0]["memberCount"] == 1

    assert (await client.get(f"{C}/consumer-groups?search=zzz")).json() == []
    assert (await client.get(f"{C}/consumer-groups?state=empty")).json() == []

    detail = (await client.get(f"{C}/consumer-groups/app-consumers")).json()
    assert detail["partitions"][0]["lag"] == 10
    assert detail["partitions"][0]["clientId"] == "client-1"
    assert detail["topicsSummary"] == [{"topic": "orders", "lag": 10, "partitions": 1}]

    assert (await client.get(f"{C}/consumer-groups/ghost")).status_code == 404


async def test_consumer_groups_paginated_envelope(client: AsyncClient) -> None:
    """`page` switches the response to the {items,total,page,perPage} envelope; omitting it keeps the list."""
    plain = (await client.get(f"{C}/consumer-groups")).json()
    assert isinstance(plain, list)

    paged = (await client.get(f"{C}/consumer-groups?page=1&perPage=10")).json()
    assert paged["page"] == 1
    assert paged["perPage"] == 10
    assert paged["total"] == len(plain)
    assert [g["groupId"] for g in paged["items"]] == [g["groupId"] for g in plain]

    # Sorting is applied before slicing; an out-of-range page is empty but keeps the total.
    sorted_desc = (await client.get(f"{C}/consumer-groups?page=1&sort=totalLag&order=desc")).json()
    assert sorted_desc["items"][0]["totalLag"] == max(g["totalLag"] for g in plain)
    empty = (await client.get(f"{C}/consumer-groups?page=99&perPage=10")).json()
    assert empty["items"] == []
    assert empty["total"] == len(plain)

    # Filters still apply inside the envelope.
    filtered = (await client.get(f"{C}/consumer-groups?page=1&search=zzz")).json()
    assert filtered == {"items": [], "page": 1, "perPage": 50, "total": 0}
    assert (await client.get(f"{C}/consumer-groups?page=0")).status_code == 422


async def test_consumer_group_time_lag_estimate(client: AsyncClient) -> None:
    """timeLagMs = lag / (topic produce rate / partitions), from the sampler's last two samples."""
    from k_shui.core.sampler import Sample

    sampler = client.app.state.samplers.get("test")  # type: ignore[attr-defined]
    # No usable rate yet (sampler may hold at most one real sample) -> estimate is unknown, not 0.
    sampler.samples.clear()
    detail = (await client.get(f"{C}/consumer-groups/app-consumers")).json()
    assert detail["partitions"][0]["lag"] == 10
    assert detail["partitions"][0]["timeLagMs"] is None
    assert detail["maxTimeLagMs"] is None

    # "orders" (3 partitions) grew by 300 messages in 10s -> 30 msg/s topic-wide, 10 msg/s per partition.
    sampler.samples.append(Sample(ts=1000.0, per_topic={"orders": 300}))
    sampler.samples.append(Sample(ts=1010.0, per_topic={"orders": 600}))
    detail = (await client.get(f"{C}/consumer-groups/app-consumers")).json()
    assert detail["partitions"][0]["timeLagMs"] == 1000
    assert detail["maxTimeLagMs"] == 1000
    groups = (await client.get(f"{C}/consumer-groups")).json()
    assert groups[0]["maxTimeLagMs"] == 1000

    # An idle topic (rate 0) also yields "unknown" rather than a misleading zero.
    sampler.samples.append(Sample(ts=1020.0, per_topic={"orders": 600}))
    detail = (await client.get(f"{C}/consumer-groups/app-consumers")).json()
    assert detail["partitions"][0]["timeLagMs"] is None


async def test_unhealthy_partitions(client: AsyncClient, admin: Any) -> None:
    from tests.fakes import FakePartition

    body = (await client.get(f"{C}/partitions/unhealthy")).json()
    assert body["items"] == []
    assert body["scannedPartitions"] == 5

    orders = admin.topics["orders"].partitions
    orders[0] = FakePartition(id=0, leader=0, replicas=[0, 1], isrs=[0])  # under-replicated
    orders[1] = FakePartition(id=1, leader=-1, replicas=[1], isrs=[])  # offline (+ URP)
    orders[2] = FakePartition(id=2, leader=1, replicas=[0, 1], isrs=[0, 1])  # non-preferred leader

    body = (await client.get(f"{C}/partitions/unhealthy")).json()
    assert body["offline"] == 1
    assert body["underReplicated"] == 2
    assert body["nonPreferredLeader"] == 1
    assert [(i["partition"], i["reasons"]) for i in body["items"]] == [
        (1, ["offline", "underReplicated"]),
        (0, ["underReplicated"]),
        (2, ["nonPreferredLeader"]),
    ]
    assert body["items"][0]["leader"] is None
    assert body["items"][2] == {
        "topic": "orders",
        "partition": 2,
        "leader": 1,
        "replicas": [0, 1],
        "isr": [0, 1],
        "reasons": ["nonPreferredLeader"],
    }


async def test_share_groups_degrades(client: AsyncClient) -> None:
    body = (await client.get(f"{C}/share-groups")).json()
    assert body["supported"] is False
    assert body["items"] == []


async def test_consumer_group_export_csv(client: AsyncClient) -> None:
    resp = await client.get(f"{C}/consumer-groups/export.csv")
    assert resp.headers["content-type"].startswith("text/csv")
    assert "app-consumers" in resp.text


@pytest.mark.parametrize(
    ("strategy", "value", "expected"),
    [
        ("earliest", None, 0),
        ("latest", None, 100),
        ("offset", 55, 55),
        ("shiftBy", -10, 80),
        ("timestamp", 123, 5),
    ],
)
async def test_offset_reset_strategies_dry_run(
    client: AsyncClient, strategy: str, value: Any, expected: int
) -> None:
    payload: dict[str, Any] = {"topic": "orders", "strategy": strategy, "dryRun": True}
    if value is not None:
        payload["value"] = value
    plan = (await client.post(f"{C}/consumer-groups/app-consumers/offsets/reset", json=payload)).json()
    assert plan[0]["oldOffset"] == 90
    assert plan[0]["newOffset"] == expected


async def test_offset_reset_applies(client: AsyncClient, admin: Any) -> None:
    resp = await client.post(
        f"{C}/consumer-groups/app-consumers/offsets/reset", json={"topic": "orders", "strategy": "earliest"}
    )
    assert resp.status_code == 200
    assert "alter_group_offsets:app-consumers" in admin.calls
    assert admin.groups["app-consumers"]["offsets"][0]["offset"] == 0


async def test_offset_reset_requires_value(client: AsyncClient) -> None:
    resp = await client.post(f"{C}/consumer-groups/app-consumers/offsets/reset", json={"strategy": "offset"})
    assert resp.status_code == 400


async def test_delete_group_offsets_and_group(client: AsyncClient) -> None:
    assert (await client.delete(f"{C}/consumer-groups/app-consumers/offsets?topic=orders")).status_code == 200
    assert (await client.delete(f"{C}/consumer-groups/app-consumers")).status_code == 200
    assert (await client.delete(f"{C}/consumer-groups/app-consumers")).status_code == 400


async def test_lag_history(client: AsyncClient) -> None:
    body = (await client.get(f"{C}/consumer-groups/app-consumers/lag-history?range=24h")).json()
    assert body["source"] == "sampled"
    assert isinstance(body["series"], list)


async def test_acls_crud(client: AsyncClient) -> None:
    assert (await client.get(f"{C}/acls")).json() == []
    created = await client.post(
        f"{C}/acls",
        json={
            "resourceType": "topic",
            "resourceName": "orders",
            "patternType": "literal",
            "principal": "User:alice",
            "host": "*",
            "operation": "read",
            "permissionType": "allow",
        },
    )
    assert created.status_code == 201
    assert (await client.get(f"{C}/acls")).json()[0]["principal"] == "User:alice"
    assert len((await client.delete(f"{C}/acls?resourceName=orders")).json()) == 1
    assert (await client.get(f"{C}/acls")).json() == []


async def test_quotas_degrade(client: AsyncClient) -> None:
    body = (await client.get(f"{C}/quotas")).json()
    assert body["supported"] is False
    assert body["reason"]


async def test_kraft_quorum(client: AsyncClient) -> None:
    body = (await client.get(f"{C}/kraft/quorum")).json()
    assert body["supported"] is True
    assert body["voters"][0]["id"] == 0


async def test_scram_users(client: AsyncClient) -> None:
    assert (await client.get(f"{C}/scram-users")).json() == []
    assert (
        await client.post(f"{C}/scram-users", json={"username": "bob", "password": "pw"})
    ).status_code == 201
    users = (await client.get(f"{C}/scram-users")).json()
    assert users[0]["username"] == "bob"
    assert users[0]["credentials"][0]["mechanism"] == "SCRAM_SHA_512"
    assert (await client.delete(f"{C}/scram-users?username=bob")).status_code == 200
    assert (await client.get(f"{C}/scram-users")).json() == []


async def test_cluster_configs(client: AsyncClient) -> None:
    configs = (await client.get(f"{C}/configs")).json()
    assert configs[0]["name"] == "min.insync.replicas"
    assert (
        await client.put(f"{C}/configs", json={"configs": {"min.insync.replicas": "2"}})
    ).status_code == 200


async def test_events_route_is_registered(client: AsyncClient) -> None:
    spec = client.app.openapi()  # type: ignore[attr-defined]
    assert "/api/v1/events" in spec["paths"]


async def test_event_bus_publish_and_stream() -> None:
    """The SSE endpoint is a thin wrapper over the bus, which is exercised directly here
    (an infinite ASGI stream cannot be closed cleanly through httpx's ASGI transport)."""
    import asyncio

    from k_shui.core.events import EventBus

    bus = EventBus()
    stream = bus.stream({"topic.created"}, "test")
    task = asyncio.create_task(anext(stream))  # type: ignore[arg-type]
    await asyncio.sleep(0)
    bus.publish("topic.deleted", "test", {})  # filtered out
    bus.publish("topic.created", "test", {"topic": "orders"})
    evt = await asyncio.wait_for(task, timeout=5)
    assert evt["type"] == "topic.created"
    assert evt["clusterId"] == "test"
    assert evt["payload"] == {"topic": "orders"}
    await stream.aclose()

    assert [e["type"] for e in bus.recent(10)] == ["topic.deleted", "topic.created"]
    assert bus.subscriber_count == 0


async def test_spa_or_json_root_never_shadows_the_api(client: AsyncClient) -> None:
    """Whatever `/` serves, unknown API paths must still 404 as problem+json."""
    resp = await client.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith(("application/problem+json", "application/json"))


# ------------------------------------------------- cluster summary is deadlined


async def test_cluster_list_reports_offline_fast_when_broker_hangs(
    client: AsyncClient, admin: Any, monkeypatch: Any
) -> None:
    """A wedged broker used to hang `/clusters` for minutes (metadata timeout plus a
    per-partition watermark sweep). The summary must give up quickly and say offline."""
    import asyncio

    from k_shui.api.routers import _common

    monkeypatch.setattr(_common, "SUMMARY_PROBE_DEADLINE", 0.2)

    async def never_answers() -> Any:
        await asyncio.sleep(30)

    monkeypatch.setattr(admin, "describe_cluster", never_answers)

    async with asyncio.timeout(5):
        items = (await client.get("/api/v1/clusters")).json()

    assert items[0]["status"] == "offline"
    assert "did not respond" in items[0]["error"]


async def test_cluster_summary_survives_a_hanging_sampler(client: AsyncClient, monkeypatch: Any) -> None:
    """The on-demand sampling fallback is bounded too, and a stalled sample must not
    stop the cluster being reported online from the metadata probe."""
    import asyncio

    from k_shui.api.routers import _common
    from k_shui.core.sampler import ClusterSampler

    monkeypatch.setattr(_common, "SUMMARY_SAMPLE_DEADLINE", 0.2)

    async def never_samples(self: Any) -> Any:
        await asyncio.sleep(30)

    monkeypatch.setattr(ClusterSampler, "sample_once", never_samples)
    monkeypatch.setattr(ClusterSampler, "latest", property(lambda self: None))

    async with asyncio.timeout(5):
        items = (await client.get("/api/v1/clusters")).json()

    assert items[0]["status"] == "online"


async def test_offset_reset_keeps_partition_scope_when_uncommitted(client: AsyncClient) -> None:
    """Scoping to partitions with no committed offsets must not expand to every partition."""
    url = f"{C}/consumer-groups/app-consumers/offsets/reset"
    scoped = {"topic": "orders", "partitions": [2], "strategy": "earliest", "dryRun": True}
    plan = (await client.post(url, json=scoped)).json()
    assert [p["partition"] for p in plan] == [2]

    resp = await client.post(url, json={"topic": "orders", "partitions": [99], "strategy": "earliest"})
    assert resp.status_code == 404
