"""Unit coverage for the pieces of the Kafka layer that do not need a broker."""

from __future__ import annotations

from typing import Any

import pytest

from k_shui.config import ClusterConfig, Settings
from k_shui.core.errors import BadRequest, Conflict, IntegrationUnavailable, NotFound, UpstreamError
from k_shui.core.registry import ClusterRegistry
from k_shui.kafka.admin import KafkaAdmin, _config_source_name, client_config
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
