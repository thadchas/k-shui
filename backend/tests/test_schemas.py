"""Schema Registry integration + router tests (upstream mocked with respx)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from tests.conftest_integrations import SR_URL, base

pytest_plugins = ["tests.conftest_integrations"]

AVRO_V1 = json.dumps({"type": "record", "name": "V", "fields": [{"name": "a", "type": "string"}]})
AVRO_V2 = json.dumps(
    {
        "type": "record",
        "name": "V",
        "fields": [{"name": "a", "type": "string"}, {"name": "b", "type": "long"}],
    }
)


def _version(subject: str, version: int, schema: str, schema_id: int) -> dict:
    return {"subject": subject, "version": version, "id": schema_id, "schema": schema}


@pytest.fixture
def sr_mock():
    with respx.mock(base_url=SR_URL, assert_all_called=False) as mock:
        mock.get("/subjects").mock(return_value=httpx.Response(200, json=["orders-value", "users-key"]))
        mock.get("/config").mock(return_value=httpx.Response(200, json={"compatibilityLevel": "BACKWARD"}))
        mock.get("/mode").mock(return_value=httpx.Response(200, json={"mode": "READWRITE"}))
        mock.get("/config/orders-value").mock(
            return_value=httpx.Response(200, json={"compatibilityLevel": "FULL"})
        )
        mock.get("/config/users-key").mock(return_value=httpx.Response(404, json={"error_code": 40408}))
        mock.get("/subjects/orders-value/versions").mock(return_value=httpx.Response(200, json=[1, 2]))
        mock.get("/subjects/users-key/versions").mock(return_value=httpx.Response(200, json=[1]))
        mock.get("/subjects/orders-value/versions/latest").mock(
            return_value=httpx.Response(200, json=_version("orders-value", 2, AVRO_V2, 11))
        )
        mock.get("/subjects/orders-value/versions/1").mock(
            return_value=httpx.Response(200, json=_version("orders-value", 1, AVRO_V1, 10))
        )
        mock.get("/subjects/orders-value/versions/2").mock(
            return_value=httpx.Response(200, json=_version("orders-value", 2, AVRO_V2, 11))
        )
        mock.get("/subjects/users-key/versions/latest").mock(
            return_value=httpx.Response(200, json=_version("users-key", 1, AVRO_V1, 12))
        )
        mock.get("/subjects/users-key/versions/1").mock(
            return_value=httpx.Response(200, json=_version("users-key", 1, AVRO_V1, 12))
        )
        yield mock


async def test_list_subjects_merges_config_and_versions(api, sr_mock):
    resp = await api.get(base("/schemas/subjects"))
    assert resp.status_code == 200
    rows = {r["subject"]: r for r in resp.json()}
    assert set(rows) == {"orders-value", "users-key"}
    orders = rows["orders-value"]
    assert orders["latestVersion"] == 2
    assert orders["versionsCount"] == 2
    assert orders["schemaType"] == "AVRO"
    assert orders["compatibility"] == "FULL"
    assert orders["compatibilityInherited"] is False
    assert orders["topic"] == "orders"
    # users-key has no per-subject config → inherits the global level
    assert rows["users-key"]["compatibility"] == "BACKWARD"
    assert rows["users-key"]["compatibilityInherited"] is True


async def test_search_filters_subjects(api, sr_mock):
    resp = await api.get(base("/schemas/subjects"), params={"search": "USER"})
    assert [r["subject"] for r in resp.json()] == ["users-key"]


async def test_subject_detail_lists_versions(api, sr_mock):
    resp = await api.get(base("/schemas/subjects/orders-value"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["compatibility"] == "FULL"
    assert [v["version"] for v in body["versions"]] == [1, 2]
    assert body["versions"][0]["schema"] == AVRO_V1


async def test_get_single_version(api, sr_mock):
    resp = await api.get(base("/schemas/subjects/orders-value/versions/1"))
    assert resp.json()["id"] == 10


async def test_register_schema(api, sr_mock):
    route = sr_mock.post("/subjects/orders-value/versions").mock(
        return_value=httpx.Response(200, json={"id": 42})
    )
    resp = await api.post(
        base("/schemas/subjects/orders-value/versions"),
        json={"schema": AVRO_V2, "schemaType": "AVRO", "normalize": True},
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == 42
    assert route.called
    request = route.calls.last.request
    assert json.loads(request.content)["schemaType"] == "AVRO"
    assert b"normalize=true" in request.url.query


async def test_register_accepts_schema_object(api, sr_mock):
    sr_mock.post("/subjects/orders-value/versions").mock(return_value=httpx.Response(200, json={"id": 7}))
    resp = await api.post(
        base("/schemas/subjects/orders-value/versions"),
        json={"schema": {"type": "string"}, "schemaType": "AVRO"},
    )
    assert resp.status_code == 201


async def test_compatibility_check(api, sr_mock):
    sr_mock.post("/compatibility/subjects/orders-value/versions/latest").mock(
        return_value=httpx.Response(200, json={"is_compatible": False, "messages": ["field removed"]})
    )
    resp = await api.post(base("/schemas/subjects/orders-value/compatibility"), json={"schema": AVRO_V1})
    assert resp.json() == {"isCompatible": False, "messages": ["field removed"]}


async def test_compatibility_check_passes_normalize(api, sr_mock):
    route = sr_mock.post("/compatibility/subjects/orders-value/versions/latest").mock(
        return_value=httpx.Response(200, json={"is_compatible": True})
    )
    resp = await api.post(
        base("/schemas/subjects/orders-value/compatibility"),
        json={"schema": AVRO_V2, "schemaType": "AVRO", "normalize": True},
    )
    assert resp.json()["isCompatible"] is True
    query = route.calls.last.request.url.query
    assert b"normalize=true" in query and b"verbose=true" in query


async def test_subject_detail_passes_deleted_flag(api, sr_mock):
    seen: list[str] = []

    def versions(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url.query, "utf-8"))
        if request.url.params.get("deleted") == "true":
            return httpx.Response(200, json=[1, 2, 3])
        return httpx.Response(200, json=[1, 2])

    sr_mock.get("/subjects/orders-value/versions").mock(side_effect=versions)
    sr_mock.get("/subjects/orders-value/versions/3").mock(
        return_value=httpx.Response(200, json={**_version("orders-value", 3, AVRO_V2, 13), "deleted": True})
    )
    resp = await api.get(base("/schemas/subjects/orders-value"), params={"deleted": True})
    assert resp.status_code == 200
    # First call lists everything (incl. soft-deleted); the second consults the live list so
    # the `deleted` flag can be derived for registries that don't set it on the payload.
    assert seen == ["deleted=true", ""]
    versions = {v["version"]: v for v in resp.json()["versions"]}
    assert versions[3]["deleted"] is True
    assert versions[1]["deleted"] is False


async def test_reset_subject_config_deletes_override(api, sr_mock):
    route = sr_mock.delete("/config/orders-value").mock(
        return_value=httpx.Response(200, json={"compatibility": "FULL"})
    )
    resp = await api.delete(base("/schemas/subjects/orders-value/config"))
    assert resp.status_code == 200
    assert route.called
    # falls back to the global level after the override is removed
    assert resp.json() == {"compatibility": "BACKWARD", "explicit": False, "normalize": None}


async def test_compatibility_on_unknown_subject_is_compatible(api, sr_mock):
    sr_mock.post("/compatibility/subjects/new-value/versions/latest").mock(
        return_value=httpx.Response(404, json={"error_code": 40401})
    )
    resp = await api.post(base("/schemas/subjects/new-value/compatibility"), json={"schema": AVRO_V1})
    assert resp.json()["isCompatible"] is True


async def test_diff_produces_unified_diff(api, sr_mock):
    resp = await api.get(base("/schemas/subjects/orders-value/diff"), params={"from": 1, "to": 2})
    body = resp.json()
    assert body["from"] == 1 and body["to"] == 2
    assert body["identical"] is False
    assert "+++" in body["unifiedDiff"]
    assert '"name": "b"' in body["unifiedDiff"]


async def test_schema_by_id(api, sr_mock):
    sr_mock.get("/schemas/ids/11").mock(
        return_value=httpx.Response(200, json={"schema": AVRO_V2, "schemaType": "AVRO"})
    )
    sr_mock.get("/schemas/ids/11/versions").mock(
        return_value=httpx.Response(200, json=[{"subject": "orders-value", "version": 2}])
    )
    body = (await api.get(base("/schemas/ids/11"))).json()
    assert body["id"] == 11
    assert body["subjects"] == [{"subject": "orders-value", "version": 2}]


async def test_global_and_subject_config_updates(api, sr_mock):
    sr_mock.put("/config").mock(return_value=httpx.Response(200, json={"compatibility": "FULL"}))
    assert (await api.put(base("/schemas/config"), json={"compatibility": "full"})).json() == {
        "compatibility": "FULL",
        "explicit": True,
    }
    sr_mock.put("/config/orders-value").mock(return_value=httpx.Response(200, json={"compatibility": "NONE"}))
    body = (
        await api.put(base("/schemas/subjects/orders-value/config"), json={"compatibility": "none"})
    ).json()
    assert body["compatibility"] == "NONE"


async def test_delete_subject_permanent_does_soft_delete_first(api, sr_mock):
    route = sr_mock.delete("/subjects/orders-value").mock(return_value=httpx.Response(200, json=[1, 2]))
    resp = await api.delete(base("/schemas/subjects/orders-value"), params={"permanent": True})
    assert resp.json() == {"subject": "orders-value", "deletedVersions": [1, 2], "permanent": True}
    assert route.call_count == 2
    assert b"permanent=true" in route.calls.last.request.url.query


async def test_delete_version(api, sr_mock):
    sr_mock.delete("/subjects/orders-value/versions/2").mock(return_value=httpx.Response(200, json=2))
    resp = await api.delete(base("/schemas/subjects/orders-value/versions/2"))
    assert resp.json()["version"] == 2


async def test_info_detects_apicurio(api, sr_mock):
    sr_mock.get("http://sr.test/apis/registry/v3/system/info").mock(
        return_value=httpx.Response(200, json={"version": "3.3.1", "name": "Apicurio Registry"})
    )
    body = (await api.get(base("/schemas/info"))).json()
    assert body["mode"] == "READWRITE"
    assert body["serverType"] == "apicurio"
    assert body["version"] == "3.3.1"
    assert body["reachable"] is True


async def test_unavailable_registry_returns_problem_json(api, sr_mock):
    sr_mock.get("/subjects/broken-value/versions").mock(return_value=httpx.Response(500, text="boom"))
    resp = await api.get(base("/schemas/subjects/broken-value"))
    assert resp.status_code == 503
    assert resp.headers["content-type"].startswith("application/problem+json")
    assert resp.json()["type"].endswith("integration-unavailable")


async def test_not_configured_cluster_returns_404_problem(api, integration_app):
    from k_shui.config import ClusterConfig

    registry = integration_app.state.registry
    registry._contexts["bare"] = type(registry.get("itest"))(
        ClusterConfig(id="bare", bootstrapServers="x:9092"), integration_app.state.settings
    )
    resp = await api.get("/api/v1/clusters/bare/schemas/subjects")
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("integration-not-configured")
