"""Authentication modes, JWT sessions, role enforcement and read-only mode."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from k_shui.config import AuthConfig, BasicAuthUser, ServerConfig, Settings
from k_shui.core.auth import Principal, create_token, decode_token, hash_password, verify_password
from k_shui.main import create_app
from tests.conftest import build_settings

C = "/api/v1/clusters/test"


async def login(client: AsyncClient, username: str, password: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ password helpers
def test_argon2_hash_round_trip() -> None:
    stored = hash_password("correct horse")
    assert stored.startswith("$argon2")
    assert verify_password(stored, "correct horse")
    assert not verify_password(stored, "wrong")


def test_plaintext_passwords_allowed_in_dev() -> None:
    assert verify_password("devpw", "devpw")
    assert not verify_password("devpw", "nope")
    assert not verify_password("", "anything")


def test_malformed_hash_does_not_raise() -> None:
    assert not verify_password("$argon2id$broken", "x")


# ------------------------------------------------------------------ tokens
def test_jwt_round_trip() -> None:
    settings = Settings(auth=AuthConfig(type="basic", jwtSecret="s3cret"))
    token, exp = create_token(settings, Principal(username="ada", role="editor", clusters=["a"]))
    principal = decode_token(settings, token)
    assert principal.username == "ada"
    assert principal.role == "editor"
    assert principal.clusters == ["a"]
    assert exp > 0


def test_jwt_rejects_foreign_secret() -> None:
    from k_shui.core.auth import Unauthorized

    good = Settings(auth=AuthConfig(type="basic", jwtSecret="a"))
    bad = Settings(auth=AuthConfig(type="basic", jwtSecret="b"))
    token, _ = create_token(good, Principal("ada", "admin"))
    with pytest.raises(Unauthorized):
        decode_token(bad, token)


def test_role_ranking() -> None:
    assert Principal("x", "admin").can("editor")
    assert Principal("x", "editor").can("viewer")
    assert not Principal("x", "viewer").can("editor")
    assert Principal("x", "viewer", clusters=["a"]).sees_cluster("a")
    assert not Principal("x", "viewer", clusters=["a"]).sees_cluster("b")


# ------------------------------------------------------------------ auth.type = none
async def test_auth_none_treats_everyone_as_anonymous_admin(client: AsyncClient) -> None:
    me = (await client.get("/api/v1/auth/me")).json()
    assert me == {"username": "anonymous", "role": "admin", "clusters": None, "anonymous": True}
    # admin-only route works without any credentials
    assert (await client.get(f"{C}/scram-users")).status_code == 200


async def test_auth_none_login_returns_anonymous_token(client: AsyncClient) -> None:
    body = (await client.post("/api/v1/auth/login", json={"username": "x", "password": "y"})).json()
    assert body["user"]["anonymous"] is True
    assert body["token"]


# ------------------------------------------------------------------ auth.type = basic
async def test_basic_requires_a_token(basic_auth_client: AsyncClient) -> None:
    resp = await basic_auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["type"].endswith("unauthorized")


async def test_basic_login_and_me(basic_auth_client: AsyncClient) -> None:
    token = await login(basic_auth_client, "root", "rootpw")
    me = (await basic_auth_client.get("/api/v1/auth/me", headers=bearer(token))).json()
    assert me["username"] == "root"
    assert me["role"] == "admin"
    assert me["anonymous"] is False


async def test_basic_login_rejects_bad_password(basic_auth_client: AsyncClient) -> None:
    resp = await basic_auth_client.post("/api/v1/auth/login", json={"username": "root", "password": "nope"})
    assert resp.status_code == 401


async def test_token_accepted_via_cookie(basic_auth_client: AsyncClient) -> None:
    token = await login(basic_auth_client, "vi", "vipw")
    basic_auth_client.cookies.set("kshui_token", token)
    assert (await basic_auth_client.get("/api/v1/auth/me")).json()["username"] == "vi"


async def test_config_users_are_materialised_into_the_db(basic_auth_client: AsyncClient) -> None:
    from sqlalchemy import select

    from k_shui.db import session as db_session
    from k_shui.db.models import User

    async with db_session.session_scope() as db:
        rows = (await db.execute(select(User))).scalars().all()
    assert {r.username for r in rows} == {"root", "ed", "vi"}
    assert all(r.password_hash.startswith("$argon2") for r in rows)
    assert {r.role for r in rows} == {"admin", "editor", "viewer"}


@pytest.mark.parametrize(
    ("user", "password", "expected"),
    [("vi", "vipw", 403), ("ed", "edpw", 201), ("root", "rootpw", 201)],
)
async def test_editor_role_required_to_create_topics(
    basic_auth_client: AsyncClient, user: str, password: str, expected: int
) -> None:
    token = await login(basic_auth_client, user, password)
    resp = await basic_auth_client.post(
        f"{C}/topics", json={"name": f"t-{user}", "partitions": 1}, headers=bearer(token)
    )
    assert resp.status_code == expected
    if expected == 403:
        assert resp.json()["type"].endswith("forbidden")


@pytest.mark.parametrize(("user", "password", "expected"), [("ed", "edpw", 403), ("root", "rootpw", 200)])
async def test_admin_role_required_for_broker_configs(
    basic_auth_client: AsyncClient, user: str, password: str, expected: int
) -> None:
    token = await login(basic_auth_client, user, password)
    resp = await basic_auth_client.put(
        f"{C}/brokers/0/configs", json={"configs": {"num.io.threads": "4"}}, headers=bearer(token)
    )
    assert resp.status_code == expected


async def test_viewer_can_read(basic_auth_client: AsyncClient) -> None:
    token = await login(basic_auth_client, "vi", "vipw")
    assert (await basic_auth_client.get(f"{C}/topics", headers=bearer(token))).status_code == 200


async def test_login_is_rate_limited(basic_auth_client: AsyncClient) -> None:
    from k_shui.api.routers.auth import _LOGIN_ATTEMPTS

    _LOGIN_ATTEMPTS.clear()
    codes = []
    for _ in range(12):
        resp = await basic_auth_client.post(
            "/api/v1/auth/login", json={"username": "root", "password": "bad"}
        )
        codes.append(resp.status_code)
    assert codes.count(401) == 12  # both bad-password and rate-limit map to 401
    _LOGIN_ATTEMPTS.clear()


# ------------------------------------------------------------------ read-only mode
@pytest_asyncio.fixture
async def read_only_client(tmp_path: Any) -> AsyncIterator[AsyncClient]:
    settings = build_settings(tmp_path, server=ServerConfig(port=0, readOnly=True))
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c,
    ):
        yield c


async def test_read_only_blocks_mutations(read_only_client: AsyncClient) -> None:
    assert (await read_only_client.get(f"{C}/topics")).status_code == 200
    resp = await read_only_client.post(f"{C}/topics", json={"name": "nope", "partitions": 1})
    assert resp.status_code == 403
    assert resp.json()["type"].endswith("read-only")
    assert (await read_only_client.delete(f"{C}/topics/orders")).status_code == 403


@pytest_asyncio.fixture
async def cluster_read_only_client(tmp_path: Any) -> AsyncIterator[AsyncClient]:
    settings = build_settings(tmp_path)
    settings.clusters[0].readOnly = True
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c,
    ):
        yield c


async def test_per_cluster_read_only(cluster_read_only_client: AsyncClient) -> None:
    resp = await cluster_read_only_client.post(f"{C}/topics", json={"name": "nope", "partitions": 1})
    assert resp.status_code == 403
    assert "read-only" in resp.json()["detail"]


# ------------------------------------------------------------------ oidc
async def test_oidc_endpoints_report_not_configured(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/oidc/login")
    assert resp.status_code == 404
    assert resp.json()["type"].endswith("integration-not-configured")


async def test_basic_auth_rejects_password_login_when_oidc(tmp_path: Any) -> None:
    settings = build_settings(
        tmp_path,
        auth=AuthConfig(
            type="oidc",
            jwtSecret="s",
            users=[BasicAuthUser(username="a", password="b", role="admin")],
        ),
    )
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c,
    ):
        resp = await c.post("/api/v1/auth/login", json={"username": "a", "password": "b"})
        assert resp.status_code == 400


# ------------------------------------------------- alerts routes are not anonymous


ALERT_READS = [
    "/api/v1/alerts/summary",
    "/api/v1/alerts/triggers",
    "/api/v1/alerts/actions",
    "/api/v1/alerts/history",
    "/api/v1/alerts/status",
    "/api/v1/alerts/metrics",
]


@pytest.mark.parametrize("path", ALERT_READS)
async def test_alert_reads_require_authentication(basic_auth_client: AsyncClient, path: str) -> None:
    """Alert actions hold notification secrets (webhook URLs, PagerDuty routing keys,
    SMTP credentials), so no alert route may be readable anonymously."""
    assert (await basic_auth_client.get(path)).status_code == 401


async def test_alert_writes_require_authentication(basic_auth_client: AsyncClient) -> None:
    action = {"name": "anon", "type": "webhook", "config": {"url": "http://evil.test/x"}}
    assert (await basic_auth_client.post("/api/v1/alerts/actions", json=action)).status_code == 401
    assert (await basic_auth_client.post("/api/v1/alerts/evaluate")).status_code == 401
    assert (await basic_auth_client.delete("/api/v1/alerts/actions/whatever")).status_code == 401


async def test_viewer_reads_alerts_but_cannot_mutate(basic_auth_client: AsyncClient) -> None:
    token = bearer(await login(basic_auth_client, "vi", "vipw"))

    assert (await basic_auth_client.get("/api/v1/alerts/triggers", headers=token)).status_code == 200
    assert (await basic_auth_client.get("/api/v1/alerts/summary", headers=token)).status_code == 200

    created = await basic_auth_client.post(
        "/api/v1/alerts/actions",
        json={"name": "nope", "type": "webhook", "config": {"url": "http://t.test"}},
        headers=token,
    )
    assert created.status_code == 403
    assert created.json()["type"].endswith("forbidden")


async def test_editor_can_manage_alert_actions(basic_auth_client: AsyncClient) -> None:
    token = bearer(await login(basic_auth_client, "ed", "edpw"))

    created = await basic_auth_client.post(
        "/api/v1/alerts/actions",
        json={"name": "ops", "type": "webhook", "config": {"url": "http://t.test"}},
        headers=token,
    )
    assert created.status_code == 201
    action_id = created.json()["id"]
    assert (
        await basic_auth_client.delete(f"/api/v1/alerts/actions/{action_id}", headers=token)
    ).status_code == 204


async def test_alerts_stay_open_when_auth_is_disabled(client: AsyncClient) -> None:
    """auth.type=none must keep the anonymous-admin behaviour used by local runs."""
    assert (await client.get("/api/v1/alerts/triggers")).status_code == 200


# ------------------------------------------------------- /info is the bootstrap doc


async def test_info_tells_anonymous_callers_how_to_sign_in(basic_auth_client: AsyncClient) -> None:
    """A client cannot authenticate until it knows the auth type, so /info answers
    anonymously — but must not leak the cluster inventory or feature flags."""
    resp = await basic_auth_client.get("/api/v1/info")
    assert resp.status_code == 200
    body = resp.json()

    assert body["auth"]["type"] == "basic"
    assert body["auth"]["enabled"] is True
    assert body["auth"]["user"] is None
    assert body["clusters"] == []
    assert body["features"] == {}


async def test_info_is_complete_once_authenticated(basic_auth_client: AsyncClient) -> None:
    token = bearer(await login(basic_auth_client, "vi", "vipw"))
    body = (await basic_auth_client.get("/api/v1/info", headers=token)).json()

    assert body["auth"]["user"]["username"] == "vi"
    assert [c["id"] for c in body["clusters"]] == ["test"]
    assert body["features"]


async def test_info_reports_anonymous_admin_when_auth_is_off(client: AsyncClient) -> None:
    body = (await client.get("/api/v1/info")).json()
    assert body["auth"]["enabled"] is False
    assert body["auth"]["user"]["role"] == "admin"
    assert body["clusters"]
