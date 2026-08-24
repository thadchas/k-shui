"""Unit coverage for the pieces of the Kafka layer that do not need a broker."""

from __future__ import annotations

from typing import Any

import pytest

from k_shui.config import ClusterConfig, Settings
from k_shui.core.errors import BadRequest, Conflict, IntegrationUnavailable, NotFound, UpstreamError
from k_shui.core.registry import ClusterRegistry
from k_shui.kafka.admin import KafkaAdmin, _config_source_name, _logdirs_to_dict, client_config
from k_shui.kafka.consumer import BrowseRequest, MessageFilter


@pytest.fixture
def raw_admin() -> KafkaAdmin:
    settings = Settings(
        clusters=[
            ClusterConfig(
                id="c",
                bootstrapServers="broker:9092",
                properties={"security.protocol": "SASL_SSL", "sasl.username": "u", "ignored": None},
            )
        ]
    )
    return KafkaAdmin(ClusterRegistry(settings).get("c"))


def test_client_config_merges_properties(raw_admin: KafkaAdmin) -> None:
    cfg = client_config(raw_admin.ctx, {"group.id": "g"})
    assert cfg["bootstrap.servers"] == "broker:9092"
    assert cfg["security.protocol"] == "SASL_SSL"
    assert cfg["group.id"] == "g"
    assert "ignored" not in cfg  # None values dropped


def test_sensitive_config_is_masked_in_logs() -> None:
    from k_shui.core.logging import mask

    assert mask("sasl.password", "hunter2") == "********"
    assert mask("ssl.key.password", "x") == "********"
    assert mask("bootstrap.servers", "broker:9092") == "broker:9092"
    assert mask("sasl.password", None) is None


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("KafkaError{code=_TIMED_OUT}", IntegrationUnavailable),
        ("KafkaError{code=_ALL_BROKERS_DOWN}", IntegrationUnavailable),
        ("UNKNOWN_TOPIC_OR_PART", NotFound),
        ("GROUP_ID_NOT_FOUND", NotFound),
        ("TOPIC_ALREADY_EXISTS", Conflict),
        ("something else entirely", UpstreamError),
    ],
)
def test_error_translation(raw_admin: KafkaAdmin, message: str, expected: type[Exception]) -> None:
    assert isinstance(raw_admin._translate(Exception(message)), expected)


def test_config_resource_validation(raw_admin: KafkaAdmin) -> None:
    with pytest.raises(BadRequest):
        raw_admin._resource("galaxy", "x")
    with pytest.raises(BadRequest):
        raw_admin._resource("topic", None)


def test_logdirs_to_dict_reads_capacity_and_errors() -> None:
    """DescribeLogDirs capacity fields are optional (-1 on old brokers) and offline dirs carry an error."""

    class TP:
        def __init__(self, topic: str, partition: int) -> None:
            self.topic, self.partition = topic, partition

    class Replica:
        def __init__(self, size: int, offset_lag: int = 0) -> None:
            self.size, self.offset_lag = size, offset_lag

    class Dir:
        def __init__(self, replicas: dict[Any, Any], total: int, usable: int, error: Any = None) -> None:
            self.replica_infos, self.total_bytes, self.usable_bytes, self.error = (
                replicas,
                total,
                usable,
                error,
            )

    result = {
        0: {
            "/data/a": Dir({TP("orders", 0): Replica(100), TP("orders", 1): Replica(50, 3)}, 10_000, 2_500),
            "/data/b": Dir({}, -1, -1, error="KAFKA_STORAGE_ERROR"),
        }
    }
    out = _logdirs_to_dict(result)
    a, b = out["0"]
    assert a["path"] == "/data/a"
    assert a["sizeBytes"] == 150
    assert a["totalBytes"] == 10_000
    assert a["usableBytes"] == 2_500
    assert a["error"] is None
    assert a["partitions"][1] == {"topic": "orders", "partition": 1, "sizeBytes": 50, "offsetLag": 3}
    assert b["totalBytes"] is None
    assert b["usableBytes"] is None
    assert b["error"] == "KAFKA_STORAGE_ERROR"


def test_config_source_name_handles_ints_and_enums() -> None:
    assert _config_source_name(None) is None
    assert _config_source_name(5) == "DEFAULT_CONFIG"
    assert _config_source_name(4) == "STATIC_BROKER_CONFIG"
    assert _config_source_name("already-a-name") == "already-a-name"


# ------------------------------------------------------------------ browse requests
def test_browse_request_validation() -> None:
    with pytest.raises(BadRequest):
        BrowseRequest(topic="t", mode="sideways")
    with pytest.raises(BadRequest):
        BrowseRequest(topic="t", filter_mode="telepathy")
    assert BrowseRequest(topic="t", limit=99999).limit == 10000
    assert BrowseRequest(topic="t", limit=0).limit == 1


async def test_plan_honours_per_partition_start_offsets() -> None:
    from k_shui.kafka.consumer import MessageBrowser
    from tests.fakes import FakeKafkaAdmin

    class _Ctx:
        class config:
            id = "c"

    browser = MessageBrowser.__new__(MessageBrowser)
    browser.admin = FakeKafkaAdmin(_Ctx())  # type: ignore[arg-type]

    # orders: 3 partitions, offsets 0..100 each
    plan = await browser._plan(
        BrowseRequest(topic="orders", mode="offset", offset=10, start_offsets={1: 50, 2: 999})
    )
    assert plan == [(0, 10, 100), (1, 50, 100)]  # p2 clamped to high → skipped as empty

    plan = await browser._plan(
        BrowseRequest(topic="orders", mode="offset", start_offsets={0: 20}, partitions=[0])
    )
    assert plan == [(0, 20, 100)]

    with pytest.raises(BadRequest):
        await browser._plan(
            BrowseRequest(topic="orders", mode="offset", start_offsets={0: 20}, partitions=[1])
        )


@pytest.mark.parametrize(
    ("mode", "expression", "message", "expected"),
    [
        ("contains", "ALICE", {"value": {"user": "alice"}}, True),
        ("contains", "bob", {"value": {"user": "alice"}}, False),
        ("contains", "trace-1", {"headers": {"id": "trace-1"}}, True),
        ("regex", r"^k-\d+$", {"key": "k-42"}, True),
        ("regex", r"^k-\d+$", {"key": "other"}, False),
        ("jsonpath", "$[?(@.region=='emea')]", {"value": {"region": "emea"}}, True),
        ("jsonpath", "$[?(@.region=='emea')]", {"value": {"region": "amer"}}, False),
        ("jsonpath", "$.items[*].sku", {"value": {"items": [{"sku": "a"}]}}, True),
    ],
)
def test_message_filter(mode: str, expression: str, message: dict[str, Any], expected: bool) -> None:
    assert MessageFilter(expression, mode).matches(message) is expected


def test_empty_filter_matches_everything() -> None:
    assert MessageFilter(None, "contains").matches({"value": None}) is True


def test_invalid_filters_are_rejected() -> None:
    with pytest.raises(BadRequest):
        MessageFilter("([", "regex")
    with pytest.raises(BadRequest):
        MessageFilter("$$$[", "jsonpath")


# ------------------------------------------------------------------ registry wiring
async def test_cluster_context_caches_and_closes_clients(settings: Any) -> None:
    registry = ClusterRegistry(settings)
    ctx = registry.get("test")
    first = KafkaAdmin.get(ctx)
    assert KafkaAdmin.get(ctx) is first  # cached on the context
    await registry.aclose()
    assert registry.get("test")._clients == {}


def test_registry_lookup(settings: Any) -> None:
    registry = ClusterRegistry(settings)
    assert registry.ids() == ["test"]
    assert registry.get("nope") is None
    assert len(registry.all()) == 1


# ----------------------------------------------------- watermark sweep bounding


async def test_watermarks_stops_at_budget(raw_admin: KafkaAdmin, monkeypatch) -> None:
    """A dead broker must not cost `partitions * timeout`: once the sweep budget is
    spent the remaining partitions report (0, 0) instead of each blocking again."""
    calls: list[float] = []
    clock = {"t": 0.0}

    class StallingConsumer:
        def get_watermark_offsets(self, _tp, timeout: float, cached: bool):
            calls.append(timeout)
            clock["t"] += timeout  # simulate the call burning its whole timeout
            raise RuntimeError("Local: Broker transport failure (_TRANSPORT)")

    monkeypatch.setattr(raw_admin, "_watermark_consumer", lambda: StallingConsumer())
    monkeypatch.setattr("time.monotonic", lambda: clock["t"])

    parts = [("t", i) for i in range(50)]
    result = await raw_admin.watermarks(parts, per_partition=2.0, budget=6.0)

    # every partition still gets an entry, but only a few calls were actually made
    assert len(result) == 50
    assert all(v == (0, 0) for v in result.values())
    assert sum(calls) <= 6.0 + 2.0
    assert len(calls) < 10


async def test_watermarks_defaults_are_bounded(raw_admin: KafkaAdmin) -> None:
    from k_shui.kafka.admin import WATERMARK_BUDGET, WATERMARK_TIMEOUT

    assert raw_admin.timeout > WATERMARK_TIMEOUT
    assert 50 * raw_admin.timeout > WATERMARK_BUDGET


async def test_watermarks_empty_is_a_noop(raw_admin: KafkaAdmin) -> None:
    assert await raw_admin.watermarks([]) == {}


# --------------------------------------------------------- wedged-client recycle


async def test_client_recycles_after_repeated_transport_failures(raw_admin: KafkaAdmin) -> None:
    """A librdkafka client can stay wedged after an outage; repeated transport
    failures must drop it so the next call builds a fresh one."""
    from k_shui.kafka.admin import RECYCLE_AFTER_TRANSPORT_FAILURES

    raw_admin._admin = object()
    raw_admin._cache["md:*"] = "stale"

    def boom() -> None:
        raise RuntimeError("Local: Broker transport failure (_TRANSPORT)")

    for _ in range(RECYCLE_AFTER_TRANSPORT_FAILURES):
        with pytest.raises(IntegrationUnavailable):
            await raw_admin._call(boom)

    assert raw_admin._needs_recycle is True
    raw_admin._recycle_if_needed()
    assert raw_admin._admin is None
    assert "md:*" not in raw_admin._cache
    assert raw_admin._transport_failures == 0


async def test_success_resets_the_failure_counter(raw_admin: KafkaAdmin) -> None:
    def boom() -> None:
        raise RuntimeError("Local: Broker transport failure (_TRANSPORT)")

    with pytest.raises(IntegrationUnavailable):
        await raw_admin._call(boom)
    assert raw_admin._transport_failures == 1

    await raw_admin._call(lambda: "ok")
    assert raw_admin._transport_failures == 0
    assert raw_admin._needs_recycle is False


async def test_non_transport_errors_do_not_recycle(raw_admin: KafkaAdmin) -> None:
    def boom() -> None:
        raise RuntimeError("UNKNOWN_TOPIC_OR_PART")

    for _ in range(5):
        with pytest.raises(NotFound):
            await raw_admin._call(boom)
    assert raw_admin._needs_recycle is False


class _WedgedConsumer:
    """get_watermark_offsets always fails with a transport-class error."""

    def __init__(self) -> None:
        self.calls = 0

    def get_watermark_offsets(self, tp, timeout=None, cached=False):
        self.calls += 1
        raise RuntimeError('KafkaError{code=_TRANSPORT,val=-195,str="broker transport failure"}')


class _HealthyConsumer:
    def get_watermark_offsets(self, tp, timeout=None, cached=False):
        return (0, 42)


async def test_wedged_watermark_consumer_recycles(raw_admin: KafkaAdmin) -> None:
    """An all-failed watermark sweep counts toward client recycling (regression:
    swallowed per-partition errors previously kept a dead consumer alive forever)."""
    from k_shui.kafka.admin import RECYCLE_AFTER_TRANSPORT_FAILURES

    wedged = _WedgedConsumer()
    raw_admin._consumer = wedged
    for _ in range(RECYCLE_AFTER_TRANSPORT_FAILURES):
        result = await raw_admin.watermarks([("orders", 0), ("orders", 1)])
        assert result == {("orders", 0): (0, 0), ("orders", 1): (0, 0)}
    assert raw_admin._needs_recycle is True

    # Next acquisition drops the wedged consumer and builds a fresh one.
    raw_admin._recycle_if_needed()
    assert raw_admin._consumer is None
    raw_admin._consumer = _HealthyConsumer()
    result = await raw_admin.watermarks([("orders", 0)])
    assert result == {("orders", 0): (0, 42)}
    assert raw_admin._transport_failures == 0
    assert raw_admin._needs_recycle is False


async def test_partial_watermark_failure_does_not_recycle(raw_admin: KafkaAdmin) -> None:
    """A sweep with at least one success must not count toward recycling."""

    class _Flaky:
        def __init__(self) -> None:
            self.n = 0

        def get_watermark_offsets(self, tp, timeout=None, cached=False):
            self.n += 1
            if self.n % 2 == 0:
                raise RuntimeError("_TRANSPORT: one broker flapping")
            return (0, 7)

    raw_admin._consumer = _Flaky()
    for _ in range(5):
        await raw_admin.watermarks([("orders", 0), ("orders", 1)])
    assert raw_admin._transport_failures == 0
    assert raw_admin._needs_recycle is False
