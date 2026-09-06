"""Guided onboarding: `POST /system/connection-test` + `POST /system/connection-config`.

The Kafka probe is exercised through its one blocking seam (``_kafka_metadata``); the HTTP
probes go through respx, so no test needs a broker or a live integration.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import pytest
import respx
import yaml
from httpx import AsyncClient

from k_shui.api.schemas.connection import ConnectionTestRequest
from k_shui.config import ClusterConfig
from k_shui.core import connection_test as ct
from tests.conftest import build_settings

TEST = "/api/v1/system/connection-test"
CONFIG = "/api/v1/system/connection-config"

SR_URL = "http://sr.test"
CONNECT_URL = "http://connect.test"
KSQL_URL = "http://ksql.test"
FLINK_URL = "http://flink.test"
PROM_URL = "http://prom.test"

FAKE_METADATA: dict[str, Any] = {
    "clusterId": "kafka-cluster-abc",
    "brokerCount": 3,
    "controllerId": 1,
    "topicCount": 12,
    "brokers": ["broker-1:9092", "broker-2:9092", "broker-3:9092"],
}


def payload(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "clusterId": "local",
        "clusterName": "Local cluster",
        "bootstrapServers": "broker-1:9092",
        "timeoutSeconds": 1.0,
    }
    body.update(overrides)
    return body


@pytest.fixture(autouse=True)
def kafka_reachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default: the candidate Kafka cluster answers. Individual tests override this."""
    monkeypatch.setattr(ct, "_kafka_metadata", lambda conf, timeout: dict(FAKE_METADATA))


def kafka_raises(monkeypatch: pytest.MonkeyPatch, message: str) -> None:
    def boom(conf: dict[str, Any], timeout: float) -> dict[str, Any]:
        raise RuntimeError(message)

    monkeypatch.setattr(ct, "_kafka_metadata", boom)


def by_component(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["component"]: c for c in body["components"]}


# --------------------------------------------------------------------------- happy path
@respx.mock
@pytest.mark.asyncio
async def test_every_provided_component_is_tested_independently(client: AsyncClient) -> None:
    respx.get(f"{SR_URL}/subjects").mock(return_value=httpx.Response(200, json=["orders-value"]))
    respx.get(f"{CONNECT_URL}/").mock(
        return_value=httpx.Response(200, json={"version": "3.9.0", "kafka_cluster_id": "kc-1"})
    )
    respx.get(f"{KSQL_URL}/info").mock(
        return_value=httpx.Response(200, json={"KsqlServerInfo": {"version": "7.6.0", "ksqlServiceId": "s"}})
    )
    flink_overview = {"flink-version": "1.19.1", "taskmanagers": 2, "slots-total": 8}
    respx.get(f"{FLINK_URL}/overview").mock(return_value=httpx.Response(200, json=flink_overview))
    respx.get(f"{PROM_URL}/api/v1/status/buildinfo").mock(
        return_value=httpx.Response(200, json={"data": {"version": "2.53.0"}})
    )

    resp = await client.post(
        TEST,
        json=payload(
            schemaRegistry={"url": SR_URL, "type": "apicurio"},
            connect={"name": "kc", "url": CONNECT_URL},
            ksqldb={"name": "ksql", "url": KSQL_URL},
            flink={"name": "flink", "url": FLINK_URL},
            prometheus={"url": PROM_URL, "labels": {"cluster": "local"}},
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    components = by_component(body)
    assert set(components) == {"kafka", "schemaRegistry", "connect", "ksqldb", "flink", "prometheus"}
    assert all(c["status"] == "ok" and c["category"] == "none" for c in components.values())
    assert components["kafka"]["metadata"]["brokerCount"] == 3
    assert components["kafka"]["metadata"]["clusterId"] == "kafka-cluster-abc"
    assert components["connect"]["metadata"]["version"] == "3.9.0"
    assert components["flink"]["metadata"]["slotsTotal"] == 8
    assert components["prometheus"]["metadata"]["version"] == "2.53.0"
    assert all(c["latencyMs"] is not None for c in components.values())


@pytest.mark.asyncio
async def test_only_kafka_is_tested_when_no_integration_is_given(client: AsyncClient) -> None:
    body = (await client.post(TEST, json=payload())).json()
    assert [c["component"] for c in body["components"]] == ["kafka"]
    assert body["ok"] is True


# --------------------------------------------------------------------------- kafka failures
@pytest.mark.asyncio
async def test_kafka_unreachable_is_reported_as_connectivity(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    kafka_raises(monkeypatch, "KafkaError{code=_ALL_BROKERS_DOWN,val=-187,str='1/1 brokers are down'}")
    body = (await client.post(TEST, json=payload())).json()
    kafka = by_component(body)["kafka"]
    assert body["ok"] is False
    assert kafka["status"] == "unreachable"
    assert kafka["category"] == "connectivity"
    assert "bootstrap address" in kafka["detail"]


@pytest.mark.asyncio
async def test_kafka_auth_failure_is_reported_as_credentials(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    kafka_raises(
        monkeypatch,
        "KafkaError{code=_AUTHENTICATION,str='SASL authentication error: Authentication failed'}",
    )
    body = (await client.post(TEST, json=payload())).json()
    kafka = by_component(body)["kafka"]
    assert kafka["status"] == "auth_failed"
    assert kafka["category"] == "credentials"
    assert "sasl.password" in kafka["detail"]


@pytest.mark.asyncio
async def test_kafka_permission_denied_is_reported_as_permissions(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    kafka_raises(monkeypatch, "KafkaError{code=CLUSTER_AUTHORIZATION_FAILED,str='Not authorized'}")
    body = (await client.post(TEST, json=payload())).json()
    kafka = by_component(body)["kafka"]
    assert kafka["status"] == "permission_denied"
    assert kafka["category"] == "permissions"
    assert "DESCRIBE" in kafka["detail"]


@pytest.mark.asyncio
async def test_kafka_bad_property_is_reported_as_configuration(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    kafka_raises(monkeypatch, 'No such configuration property: "sasl.mechanisms.typo"')
    body = (await client.post(TEST, json=payload(properties={"sasl.mechanisms.typo": "PLAIN"}))).json()
    kafka = by_component(body)["kafka"]
    assert kafka["status"] == "invalid"
    assert kafka["category"] == "configuration"


@pytest.mark.asyncio
async def test_kafka_probe_is_bounded_by_the_requested_timeout(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ct, "TIMEOUT_GRACE", 0.1)

    def slow(conf: dict[str, Any], timeout: float) -> dict[str, Any]:
        time.sleep(5)  # a wedged librdkafka client that never answers
        return dict(FAKE_METADATA)

    monkeypatch.setattr(ct, "_kafka_metadata", slow)
    started = time.perf_counter()
    body = (await client.post(TEST, json=payload(timeoutSeconds=1.0))).json()
    elapsed = time.perf_counter() - started

    kafka = by_component(body)["kafka"]
    assert kafka["status"] == "unreachable"
    assert kafka["category"] == "connectivity"
    assert elapsed < 4, "the probe must not outlive the requested timeout"


# --------------------------------------------------------------------------- http failures
@respx.mock
@pytest.mark.asyncio
async def test_partial_result_kafka_ok_registry_down(client: AsyncClient) -> None:
    respx.get(f"{SR_URL}/subjects").mock(side_effect=httpx.ConnectError("connection refused"))
    body = (await client.post(TEST, json=payload(schemaRegistry={"url": SR_URL}))).json()

    components = by_component(body)
    assert body["ok"] is False
    assert components["kafka"]["status"] == "ok"
    assert components["schemaRegistry"]["status"] == "unreachable"
    assert components["schemaRegistry"]["category"] == "connectivity"
    # a failed integration never invalidates the Kafka result, and the config is still generated
    assert "bootstrapServers: broker-1:9092" in body["config"]["yaml"]


@respx.mock
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("code", "status", "category"),
    [
        (401, "auth_failed", "credentials"),
        (403, "permission_denied", "permissions"),
        (404, "invalid", "configuration"),
        (500, "unreachable", "connectivity"),
    ],
)
async def test_http_status_codes_map_to_failure_categories(
    client: AsyncClient, code: int, status: str, category: str
) -> None:
    respx.get(f"{SR_URL}/subjects").mock(return_value=httpx.Response(code, text="nope"))
    body = (await client.post(TEST, json=payload(schemaRegistry={"url": SR_URL}))).json()
    registry = by_component(body)["schemaRegistry"]
    assert registry["status"] == status
    assert registry["category"] == category


@respx.mock
@pytest.mark.asyncio
async def test_non_json_body_is_a_configuration_problem(client: AsyncClient) -> None:
    respx.get(f"{SR_URL}/subjects").mock(return_value=httpx.Response(200, text="<html>hello</html>"))
    body = (await client.post(TEST, json=payload(schemaRegistry={"url": SR_URL}))).json()
    registry = by_component(body)["schemaRegistry"]
    assert registry["status"] == "invalid"
    assert "API root" in registry["detail"]


@pytest.mark.asyncio
async def test_non_http_url_is_rejected_without_a_request(client: AsyncClient) -> None:
    body = (await client.post(TEST, json=payload(connect={"url": "ftp://connect.test"}))).json()
    connect = by_component(body)["connect"]
    assert connect["status"] == "invalid"
    assert connect["category"] == "configuration"


@respx.mock
@pytest.mark.asyncio
async def test_prometheus_falls_back_when_buildinfo_is_absent(client: AsyncClient) -> None:
    respx.get(f"{PROM_URL}/api/v1/status/buildinfo").mock(return_value=httpx.Response(404))
    respx.get(f"{PROM_URL}/api/v1/query").mock(return_value=httpx.Response(200, json={"status": "success"}))
    body = (await client.post(TEST, json=payload(prometheus={"url": PROM_URL}))).json()
    assert by_component(body)["prometheus"]["status"] == "ok"


# --------------------------------------------------------------------------- secrets
@respx.mock
@pytest.mark.asyncio
async def test_response_never_echoes_submitted_secrets(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = "sup3r-secret-pw"
    token = "tok-abcdef123456"
    # An upstream error that quotes the credential back at us must still be scrubbed.
    kafka_raises(monkeypatch, f"sasl authentication failed for user with password {secret}")
    respx.get(f"{SR_URL}/subjects").mock(return_value=httpx.Response(401, text=f"bad token {token}"))

    resp = await client.post(
        TEST,
        json=payload(
            properties={"security.protocol": "SASL_SSL", "sasl.username": "svc", "sasl.password": secret},
            schemaRegistry={"url": SR_URL, "auth": {"bearerToken": token}},
        ),
    )
    raw = resp.text
    assert secret not in raw
    assert token not in raw
    assert "***" in raw
    body = resp.json()
    generated = body["config"]["yaml"]
    assert "${KSHUI_LOCAL_SASL_PASSWORD}" in generated
    assert "security.protocol: SASL_SSL" in generated


@pytest.mark.asyncio
async def test_url_userinfo_is_stripped_from_targets_and_yaml(client: AsyncClient) -> None:
    body = (
        await client.post(TEST, json=payload(connect={"url": "http://user:hunter2@connect.test:8083"}))
    ).json()
    assert "hunter2" not in body["config"]["yaml"]
    assert by_component(body)["connect"]["target"] == "http://connect.test:8083"


# --------------------------------------------------------------------------- config generator
@pytest.mark.asyncio
async def test_generated_yaml_parses_back_into_a_cluster_config(client: AsyncClient) -> None:
    resp = await client.post(
        CONFIG,
        json=payload(
            properties={"security.protocol": "SASL_SSL", "sasl.username": "svc", "sasl.password": "pw"},
            schemaRegistry={"url": SR_URL, "type": "karapace", "auth": {"username": "u", "password": "p"}},
            connect={"name": "kc", "url": CONNECT_URL},
            flink={"name": "f", "url": FLINK_URL, "sqlGatewayUrl": f"{FLINK_URL}/gw"},
            prometheus={"url": PROM_URL, "labels": {"cluster": "local"}},
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    parsed = yaml.safe_load(body["yaml"])
    cluster = ClusterConfig(**parsed["clusters"][0])

    assert cluster.id == "local"
    assert cluster.name == "Local cluster"
    assert cluster.bootstrapServers == "broker-1:9092"
    assert cluster.properties["sasl.password"] == "${KSHUI_LOCAL_SASL_PASSWORD}"
    assert cluster.properties["security.protocol"] == "SASL_SSL"
    assert cluster.schemaRegistry is not None and cluster.schemaRegistry.type == "karapace"
    assert cluster.connect[0].name == "kc"
    assert cluster.flink[0].sqlGatewayUrl == f"{FLINK_URL}/gw"
    assert cluster.metricsMode == "prometheus"

    names = {hint["name"] for hint in body["envVars"]}
    assert names == {
        "KSHUI_LOCAL_SASL_USERNAME",
        "KSHUI_LOCAL_SASL_PASSWORD",
        "KSHUI_LOCAL_SCHEMA_REGISTRY_USERNAME",
        "KSHUI_LOCAL_SCHEMA_REGISTRY_PASSWORD",
    }


@pytest.mark.asyncio
async def test_config_generation_makes_no_network_calls(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    kafka_raises(monkeypatch, "should never be called")
    resp = await client.post(CONFIG, json=payload(connect={"url": CONNECT_URL}))
    assert resp.status_code == 200
    assert "connect.test" in resp.json()["yaml"]


# --------------------------------------------------------------------------- rbac & audit
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user", "password", "expected"), [("vi", "vipw", 403), ("ed", "edpw", 403), ("root", "rootpw", 200)]
)
async def test_connection_test_requires_admin(
    basic_auth_client: AsyncClient, user: str, password: str, expected: int
) -> None:
    login = await basic_auth_client.post("/api/v1/auth/login", json={"username": user, "password": password})
    token = login.json()["token"]
    resp = await basic_auth_client.post(TEST, json=payload(), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == expected


@pytest.mark.asyncio
async def test_connection_test_needs_authentication(basic_auth_client: AsyncClient) -> None:
    assert (await basic_auth_client.post(TEST, json=payload())).status_code == 401


@pytest.mark.asyncio
async def test_connection_test_is_allowed_in_read_only_mode(tmp_path: Any) -> None:
    """It probes and renders; it never writes. Read-only deployments must still get it."""
    from httpx import ASGITransport

    from k_shui.config import ServerConfig
    from k_shui.main import create_app

    settings = build_settings(tmp_path, server=ServerConfig(port=0, readOnly=True))
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as c:
            assert (await c.post(TEST, json=payload())).status_code == 200


@pytest.mark.asyncio
async def test_connection_test_is_audited_without_secrets(client: AsyncClient) -> None:
    await client.post(TEST, json=payload(properties={"sasl.password": "hunter2-secret"}))
    entries = (await client.get("/api/v1/audit", params={"action": "system.connection_test"})).json()
    assert entries["total"] >= 1
    record = entries["items"][0]
    assert record["action"] == "system.connection_test"
    assert record["details"]["results"] == {"kafka": "ok"}
    assert "hunter2-secret" not in str(record)


# --------------------------------------------------------------------------- pure helpers
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("KafkaError{code=_TRANSPORT}", "unreachable"),
        ("Local: Broker transport failure", "unreachable"),
        ("SASL authentication error", "auth_failed"),
        ("TOPIC_AUTHORIZATION_FAILED", "permission_denied"),
        ("No such configuration property: foo", "invalid"),
        ("something entirely new", "unreachable"),
    ],
)
def test_classify_kafka_error(text: str, expected: str) -> None:
    assert ct.classify_kafka_error(text) == expected


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("sasl.password", True),
        ("sasl.username", True),
        ("ssl.key.password", True),
        ("ssl.ca.location", False),
        ("ssl.keystore.location", False),
        ("security.protocol", False),
        ("client.id", False),
    ],
)
def test_is_credential_key(key: str, expected: bool) -> None:
    assert ct.is_credential_key(key) is expected


def test_env_var_name_is_upper_snake() -> None:
    assert ct.env_var_name("prod-eu", "sasl.password") == "KSHUI_PROD_EU_SASL_PASSWORD"
    assert ct.env_var_name("a.b", "schema_registry", "token") == "KSHUI_A_B_SCHEMA_REGISTRY_TOKEN"


def test_redact_url_drops_userinfo() -> None:
    assert ct.redact_url("https://u:p@host:8081/api") == "https://host:8081/api"
    assert ct.redact_url("https://host:8081/api") == "https://host:8081/api"
    assert ct.redact_url("not a url") == "not a url"


def test_generate_config_omits_empty_sections() -> None:
    generated = ct.generate_config(ConnectionTestRequest(bootstrapServers="localhost:9092"))
    parsed = yaml.safe_load(generated.yaml)
    cluster = parsed["clusters"][0]
    assert cluster == {"id": "local", "name": "local", "bootstrapServers": "localhost:9092"}
    assert generated.envVars == []
    assert generated.yaml.startswith("# Generated by k-shui")
