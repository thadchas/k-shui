"""Audit trail: explicit helper entries, middleware fallback and the /audit endpoint."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from k_shui.core.audit import list_audit, write_audit

C = "/api/v1/clusters/test"


async def fetch(client: AsyncClient, **params: Any) -> dict[str, Any]:
    return (await client.get("/api/v1/audit", params=params)).json()


async def test_audit_starts_empty(client: AsyncClient) -> None:
    body = await fetch(client)
    assert body == {"items": [], "page": 1, "perPage": 50, "total": 0}


async def test_mutations_are_audited_with_explicit_actions(client: AsyncClient) -> None:
    await client.post(f"{C}/topics", json={"name": "audited", "partitions": 1})
    await client.put(f"{C}/topics/audited/configs", json={"configs": {"retention.ms": "5000"}})
    await client.delete(f"{C}/topics/audited")

    body = await fetch(client)
    actions = [i["action"] for i in body["items"]]
    assert actions == ["topic.delete", "topic.configs.update", "topic.create"]  # newest first
    created = body["items"][-1]
    assert created["resource"] == "audited"
    assert created["clusterId"] == "test"
    assert created["user"] == "anonymous"
    assert created["details"] == {"partitions": 1}
    assert created["ts"]


async def test_reads_are_not_audited(client: AsyncClient) -> None:
    await client.get(f"{C}/topics")
    await client.get(f"{C}/brokers")
    assert (await fetch(client))["total"] == 0


async def test_explicit_audit_suppresses_the_generic_middleware_entry(client: AsyncClient) -> None:
    resp = await client.post(
        f"{C}/acls",
        json={
            "resourceType": "topic",
            "resourceName": "orders",
            "principal": "User:x",
            "operation": "read",
            "permissionType": "allow",
        },
    )
    assert resp.status_code == 201
    items = (await fetch(client))["items"]
    assert [i["action"] for i in items] == ["acl.create"]  # exactly one row, not two


async def test_middleware_audits_routes_without_an_explicit_call(tmp_path: Any) -> None:
    """Routes that never call ``audit()`` still leave a generic verb+path trail."""
    from fastapi import FastAPI
    from httpx import ASGITransport
    from httpx import AsyncClient as Client

    from k_shui.core.audit import AuditMiddleware
    from k_shui.db import session as db_session
    from tests.conftest import build_settings

    settings = build_settings(tmp_path)
    await db_session.init_db(settings)
    try:
        app = FastAPI()
        app.add_middleware(AuditMiddleware)

        @app.post("/api/v1/clusters/{cluster_id}/widgets")
        async def make_widget(cluster_id: str) -> dict[str, bool]:
            return {"ok": True}

        @app.get("/api/v1/clusters/{cluster_id}/widgets")
        async def list_widgets(cluster_id: str) -> dict[str, bool]:
            return {"ok": True}

        async with Client(transport=ASGITransport(app=app), base_url="http://t") as c:
            await c.get("/api/v1/clusters/test/widgets?x=1")
            await c.post("/api/v1/clusters/test/widgets?x=1")

        body = await list_audit()
        assert body["total"] == 1  # only the POST
        entry = body["items"][0]
        assert entry["action"] == "POST /api/v1/clusters/test/widgets"
        assert entry["resource"] == "/api/v1/clusters/test/widgets"
        assert entry["clusterId"] == "test"
        assert entry["status"] == 200
        assert entry["details"] == {"query": {"x": "1"}}
    finally:
        await db_session.close_db()


async def test_audit_filters_and_pagination(client: AsyncClient) -> None:
    for i in range(6):
        await write_audit(
            user="ada" if i % 2 else "bob", action=f"test.action{i}", resource=f"r{i}", cluster_id="test"
        )

    page1 = await fetch(client, perPage=4)
    assert page1["total"] == 6
    assert len(page1["items"]) == 4
    page2 = await fetch(client, perPage=4, page=2)
    assert len(page2["items"]) == 2

    by_user = await fetch(client, user="ada")
    assert by_user["total"] == 3
    assert {i["user"] for i in by_user["items"]} == {"ada"}

    by_action = await fetch(client, action="action3")
    assert by_action["total"] == 1

    by_cluster = await fetch(client, clusterId="other")
    assert by_cluster["total"] == 0


async def test_audit_records_the_authenticated_user(basic_auth_client: AsyncClient) -> None:
    token = (
        await basic_auth_client.post("/api/v1/auth/login", json={"username": "ed", "password": "edpw"})
    ).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    await basic_auth_client.post(f"{C}/topics", json={"name": "by-ed", "partitions": 1}, headers=headers)

    body = (await basic_auth_client.get("/api/v1/audit", headers=headers)).json()
    entries = {i["action"]: i for i in body["items"]}
    assert entries["topic.create"]["user"] == "ed"
    assert entries["auth.login"]["user"] == "ed"
    assert entries["auth.login"]["details"] == {"role": "editor"}


async def test_write_audit_never_raises_without_a_db(monkeypatch: Any) -> None:
    from k_shui.db import session as db_session

    monkeypatch.setattr(db_session, "is_ready", lambda: False)
    await write_audit(user="x", action="noop")  # must not raise
    assert await list_audit() == {"items": [], "page": 1, "perPage": 50, "total": 0}


async def test_message_produce_and_export_are_audited(client: AsyncClient) -> None:
    await client.post(f"{C}/topics/orders/messages", json={"key": "k", "value": {"a": 1}})
    await client.get(f"{C}/topics/orders/messages/export?format=json&limit=1")
    actions = [i["action"] for i in (await fetch(client))["items"]]
    assert actions == ["message.export", "message.produce"]
