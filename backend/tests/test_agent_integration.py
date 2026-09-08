"""Agent API release gates across authentication, ownership and deployment scope."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from k_shui.config import AgentConfig, AgentConnectionConfig
from k_shui.core.auth import Principal, create_token
from k_shui.db import session as db_session
from k_shui.db.models import User
from k_shui.kafka.admin import KafkaAdmin

PREFIX = "/api/v1/agent"


def configure(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> Any:
    app = client.app  # type: ignore[attr-defined]
    monkeypatch.setenv("KSHUI_AGENT_INTEGRATION_KEY", "test-provider-secret-never-return")
    app.state.settings.agent = AgentConfig(
        enabled=True,
        allowedClusters=["test"],
        connections=[
            AgentConnectionConfig(
                id="test",
                name="Test provider",
                provider="openai",
                model="test-model",
                apiKeyEnv="KSHUI_AGENT_INTEGRATION_KEY",
                allowedClusters=["test"],
                inputUsdPerMillion=1,
                outputUsdPerMillion=1,
            )
        ],
    )
    return app


def as_user(app: Any, username: str, role: str, clusters: list[str] | None = None) -> dict[str, str]:
    token, _ = create_token(app.state.settings, Principal(username, role, clusters))
    return {"Authorization": f"Bearer {token}"}


async def test_agent_status_does_not_break_anonymous_shell(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure(client, monkeypatch)
    response = await client.get(f"{PREFIX}/status")
    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert "test-provider-secret-never-return" not in response.text
    assert (await client.get(f"{PREFIX}/investigations")).status_code in (401, 403)


async def test_agent_investigation_is_private_to_its_initiator(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    editor = as_user(app, "ed", "editor")
    viewer = as_user(app, "vi", "viewer")
    created = await client.post(
        f"{PREFIX}/investigations",
        headers=editor,
        json={
            "clusterId": "test",
            "connectionId": "test",
            "mode": "inspect",
            "title": "Private investigation",
        },
    )
    assert created.status_code in (200, 201), created.text
    investigation_id = created.json()["id"]
    foreign = await client.get(f"{PREFIX}/investigations/{investigation_id}", headers=viewer)
    assert foreign.status_code in (403, 404)
    listing = await client.get(f"{PREFIX}/investigations", headers=viewer)
    assert listing.status_code == 200
    assert investigation_id not in listing.text
    assert (
        await client.get(f"{PREFIX}/investigations/{investigation_id}", headers=editor)
    ).status_code == 200


async def test_agent_creation_respects_session_cluster_scope(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    response = await client.post(
        f"{PREFIX}/investigations",
        headers=as_user(app, "ed", "editor", []),
        json={
            "clusterId": "test",
            "connectionId": "test",
            "mode": "inspect",
        },
    )
    assert response.status_code == 403


async def test_viewer_cannot_request_operate_even_when_deployment_allows_it(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    app.state.settings.agent.allowMutations = True
    response = await client.post(
        f"{PREFIX}/investigations",
        headers=as_user(app, "vi", "viewer"),
        json={
            "clusterId": "test",
            "connectionId": "test",
            "mode": "operate",
        },
    )
    assert response.status_code == 403


async def test_status_never_returns_provider_credentials(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    response = await client.get(f"{PREFIX}/status", headers=as_user(app, "ed", "editor"))
    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert "test-provider-secret-never-return" not in response.text


async def prepare_topic(client: AsyncClient, app: Any) -> tuple[dict[str, str], str, str]:
    app.state.settings.agent.allowMutations = True
    headers = as_user(app, "ed", "editor")
    created = await client.post(
        f"{PREFIX}/investigations",
        headers=headers,
        json={
            "clusterId": "test",
            "connectionId": "test",
            "mode": "operate",
        },
    )
    assert created.status_code == 201, created.text
    path = f"{PREFIX}/investigations/{created.json()['id']}"
    prepared = await client.post(
        f"{path}/operations/prepare",
        headers=headers,
        json={
            "action": "topic.create",
            "target": {"name": "agent-release-gate"},
            "parameters": {"partitions": 1, "replicationFactor": 1},
        },
    )
    assert prepared.status_code == 200, prepared.text
    return headers, path, prepared.json()["id"]


async def test_permission_revocation_after_preview_blocks_dispatch(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    headers, path, operation_id = await prepare_topic(client, app)
    async with db_session.session_scope() as session:
        await session.execute(update(User).where(User.username == "ed").values(role="viewer"))
    response = await client.post(f"{path}/operations/{operation_id}/execute", headers=headers, json={})
    assert response.status_code == 403
    topics = await KafkaAdmin.get(app.state.registry.get("test")).list_topics()
    assert all(topic["name"] != "agent-release-gate" for topic in topics)


async def test_verified_operation_replay_never_dispatches_twice(
    basic_auth_client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = basic_auth_client
    app = configure(client, monkeypatch)
    headers, path, operation_id = await prepare_topic(client, app)
    execute_path = f"{path}/operations/{operation_id}/execute"
    response = await client.post(execute_path, headers=headers, json={})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "succeeded", response.text
    admin = KafkaAdmin.get(app.state.registry.get("test"))

    async def forbidden_second_dispatch(*args: Any, **kwargs: Any) -> None:
        pytest.fail("a verified mutation must not be dispatched again")

    monkeypatch.setattr(admin, "create_topic", forbidden_second_dispatch)
    replay = await client.post(execute_path, headers=headers, json={})
    assert replay.status_code == 200
    assert replay.json()["status"] == "succeeded"


async def test_cancel_completed_investigation_proposal_stays_cancelled(basic_auth_client, monkeypatch):
    from k_shui.db.models import AgentInvestigation

    client = basic_auth_client
    app = configure(client, monkeypatch)
    headers, path, op_id = await prepare_topic(client, app)
    async with db_session.session_scope() as session:
        row = await session.get(AgentInvestigation, path.rsplit("/", 1)[1])
        row.status = "succeeded"
    response = await client.post(f"{path}/operations/{op_id}/cancel", headers=headers)
    assert response.json()["status"] == "cancelled"
    reopened = (await client.get(path, headers=headers)).json()
    assert reopened["operations"][0]["status"] == "cancelled"
    response = await client.post(f"{path}/operations/{op_id}/execute", headers=headers, json={})
    assert response.json()["status"] == "cancelled"
    topics = await KafkaAdmin.get(app.state.registry.get("test")).list_topics()
    assert all(topic["name"] != "agent-release-gate" for topic in topics)


async def test_connection_starters_receive_intersected_tool_policy(basic_auth_client, monkeypatch):
    client = basic_auth_client
    app = configure(client, monkeypatch)
    app.state.settings.agent.allowedTools = ["get_cluster_health", "get_group_lag"]
    app.state.settings.agent.connections[0].allowedTools = ["get_group_lag", "get_topic_metadata"]
    response = await client.get(f"{PREFIX}/status", headers=as_user(app, "ed", "editor"))
    assert response.json()["connections"][0]["allowedTools"] == ["get_group_lag"]
