"""Mutation release gates: concrete previews, revocation, idempotence, audit and outcomes."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from k_shui.agent.operations import (
    AgentOperation,
    cancel_operation,
    execute_operation,
    prepare_operation,
    recover_interrupted_operations,
)
from k_shui.core.auth import Principal
from k_shui.core.errors import BadRequest, Conflict, Forbidden
from k_shui.db import session as db_session
from k_shui.db.models import AuditLog, User
from tests.test_agent_tools import request_for, settings  # noqa: F401

OPERATOR = Principal("operator", "editor", ["test"])


async def prepare(
    app: Any, action: str, name: str = "orders", parameters: dict[str, Any] | None = None
) -> dict[str, Any]:
    return await prepare_operation(
        request_for(app), OPERATOR, "investigation", "test", action, {"name": name}, parameters or {}
    )


async def execute(app: Any, op: dict[str, Any], confirmation: str | None = None) -> dict[str, Any]:
    return await execute_operation(
        request_for(app), OPERATOR, "investigation", "test", op["id"], confirmation
    )


async def test_should_deny_viewer_before_mutation_preparation(app: Any, admin: Any, monkeypatch: Any) -> None:
    probe = AsyncMock()
    monkeypatch.setattr(admin, "delete_topic", probe)
    with pytest.raises(Forbidden):
        await prepare_operation(
            request_for(app),
            Principal("viewer", "viewer"),
            "investigation",
            "test",
            "topic.delete",
            {"name": "orders"},
            {},
        )
    probe.assert_not_awaited()


async def test_should_create_topic_once_and_verify_resource_and_audit(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    create = AsyncMock(wraps=admin.create_topic)
    monkeypatch.setattr(admin, "create_topic", create)
    op = await prepare(
        app,
        "topic.create",
        "new-topic",
        {"partitions": 2, "replicationFactor": 1, "configs": {"retention.ms": "86400000"}},
    )
    assert op["preview"]["create"]["configs"] == {"retention.ms": "86400000"}
    result = await execute(app, op)
    retry = await execute(app, op)
    assert result["status"] == retry["status"] == "succeeded"
    assert result["href"] == "/c/test/topics/new-topic"
    create.assert_awaited_once()
    async with db_session.session_scope() as session:
        audits = (
            (await session.execute(select(AuditLog).where(AuditLog.action.like("agent.topic.create.%"))))
            .scalars()
            .all()
        )
    assert {r.action for r in audits} == {
        "agent.topic.create.prepared",
        "agent.topic.create.running",
        "agent.topic.create.verifying",
        "agent.topic.create.succeeded",
    }
    assert all(r.user == "operator" and r.details["origin"] == "agent" for r in audits)


async def test_should_enforce_exact_typed_confirmation_and_binding(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    delete = AsyncMock(wraps=admin.delete_topic)
    monkeypatch.setattr(admin, "delete_topic", delete)
    op = await prepare(app, "topic.delete")
    for confirmation in (None, "yes", "events"):
        with pytest.raises(BadRequest):
            await execute(app, op, confirmation)
    with pytest.raises(Forbidden):
        await execute_operation(
            request_for(app), OPERATOR, "different-investigation", "test", op["id"], "orders"
        )
    delete.assert_not_awaited()
    result = await execute(app, op, "orders")
    assert result["status"] == "succeeded" and result["after"]["exists"] is False


async def test_should_reject_expired_preview_and_changed_state(app: Any, admin: Any) -> None:
    op = await prepare(app, "topic.partitions.increase", parameters={"count": 4})
    admin.topics["orders"].partitions[0].replicas = [1]
    with pytest.raises(Conflict, match="state changed"):
        await execute(app, op, "orders")
    async with db_session.session_scope() as session:
        await session.execute(
            update(AgentOperation).where(AgentOperation.id == op["id"]).values(expires_at=1)
        )
    with pytest.raises(Conflict, match="expired"):
        await execute(app, op, "orders")


async def test_should_block_permission_revocation_between_preview_and_execution(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    dispatch = AsyncMock()
    monkeypatch.setattr(admin, "delete_topic", dispatch)
    op = await prepare(app, "topic.delete")
    async with db_session.session_scope() as session:
        await session.execute(update(User).where(User.username == "operator").values(role="viewer"))
    with pytest.raises(Forbidden):
        await execute(app, op, "orders")
    dispatch.assert_not_awaited()


async def test_should_keep_cancelled_operation_from_dispatch(app: Any, admin: Any, monkeypatch: Any) -> None:
    dispatch = AsyncMock()
    monkeypatch.setattr(admin, "delete_topic", dispatch)
    op = await prepare(app, "topic.delete")
    await cancel_operation(request_for(app), OPERATOR, "investigation", "test", op["id"])
    assert (await execute(app, op, "orders"))["status"] == "cancelled"
    dispatch.assert_not_awaited()


async def test_should_never_retry_uncertain_mutation(app: Any, admin: Any, monkeypatch: Any) -> None:
    dispatch = AsyncMock(side_effect=TimeoutError("password=DO-NOT-LEAK"))
    monkeypatch.setattr(admin, "delete_topic", dispatch)
    op = await prepare(app, "topic.delete")
    result = await execute(app, op, "orders")
    assert result["status"] == "outcome_unknown" and "DO-NOT-LEAK" not in str(result)
    assert (await execute(app, op, "orders"))["status"] == "outcome_unknown"
    dispatch.assert_awaited_once()


async def test_should_claim_once_for_concurrent_execution_retries(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    original = admin.delete_topic
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed(name: str) -> Any:
        entered.set()
        await release.wait()
        return await original(name)

    dispatch = AsyncMock(side_effect=delayed)
    monkeypatch.setattr(admin, "delete_topic", dispatch)
    op = await prepare(app, "topic.delete")
    first = asyncio.create_task(execute(app, op, "orders"))
    await entered.wait()
    second = await execute(app, op, "orders")
    release.set()
    assert second["status"] == "running"
    assert (await first)["status"] == "succeeded"
    dispatch.assert_awaited_once()


async def test_should_preview_offset_reset_and_apply_exact_dry_run_plan(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    admin.groups["app-consumers"]["state"] = "empty"
    admin.groups["app-consumers"]["members"] = []
    dispatch = AsyncMock(wraps=admin.alter_group_offsets)
    monkeypatch.setattr(admin, "alter_group_offsets", dispatch)
    op = await prepare(
        app,
        "group.offsets.reset",
        "app-consumers",
        {"topic": "orders", "strategy": "earliest", "partitions": [0]},
    )
    assert op["preview"]["dryRun"] is True and len(op["preview"]["offsets"]) == 1
    with pytest.raises(BadRequest):
        await execute(app, op)
    dispatch.assert_not_awaited()
    result = await execute(app, op, "app-consumers")
    assert result["status"] == "succeeded"
    dispatch.assert_awaited_once_with("app-consumers", [("orders", 0, 0)])


async def test_should_refuse_active_consumer_reset(app: Any) -> None:
    with pytest.raises(Conflict, match="stop group consumers"):
        await prepare(app, "group.offsets.reset", "app-consumers", {"strategy": "latest"})


async def test_should_apply_purge_only_to_concrete_preview_offsets(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    dispatch = AsyncMock(wraps=admin.delete_records)
    monkeypatch.setattr(admin, "delete_records", dispatch)
    op = await prepare(app, "topic.purge")
    assert all(o["beforeOffset"] == 100 for o in op["preview"]["offsets"])
    result = await execute(app, op, "orders")
    assert result["status"] == "succeeded"
    assert all(row[2] == 100 for row in dispatch.call_args.args[0])


@pytest.mark.parametrize(
    "action,target,params",
    [
        ("topic.create", {"name": "x"}, {"partitions": 0}),
        ("topic.create", {"name": "x"}, {"configs": {"sasl.jaas.config": "password=SECRET"}}),
        ("topic.config.update", {"name": "orders"}, {"configs": {"retention.ms": "password=SECRET"}}),
        ("topic.delete", {"name": "__consumer_offsets"}, {}),
        ("topic.delete", {"name": "orders", "clusterId": "other"}, {}),
        ("shell", {"name": "orders"}, {}),
        ("group.offsets.reset", {"name": "app-consumers"}, {"partitions": []}),
    ],
)
async def test_should_exclude_unsupported_unsafe_operation_parameters(
    app: Any, action: str, target: dict[str, Any], params: dict[str, Any]
) -> None:
    with pytest.raises(BadRequest):
        await prepare_operation(request_for(app), OPERATOR, "investigation", "test", action, target, params)


async def test_should_reconcile_interrupted_state_without_dispatch(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    dispatch = AsyncMock()
    monkeypatch.setattr(admin, "delete_topic", dispatch)
    op = await prepare(app, "topic.delete")
    async with db_session.session_scope() as session:
        await session.execute(
            update(AgentOperation).where(AgentOperation.id == op["id"]).values(status="running")
        )
    await recover_interrupted_operations()
    assert (await execute(app, op, "orders"))["status"] == "outcome_unknown"
    dispatch.assert_not_awaited()


@pytest.mark.parametrize(
    "action", ["connector.pause", "connector.resume", "connector.restart", "connector.task.restart"]
)
async def test_should_execute_connector_actions_and_verify_task_state(
    app: Any, monkeypatch: Any, action: str
) -> None:
    from k_shui.integrations import connect

    state = {"connector": {"state": "RUNNING"}, "tasks": [{"id": 2, "state": "FAILED"}]}

    async def apply(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        state["connector"]["state"] = "PAUSED" if action == "connector.pause" else "RUNNING"
        state["tasks"][0]["state"] = "RUNNING"
        return {}

    dispatch = AsyncMock(side_effect=apply)
    client = type(
        "Connect",
        (),
        {
            "status": AsyncMock(side_effect=lambda _: state),
            "pause": dispatch,
            "resume": dispatch,
            "restart": dispatch,
            "restart_task": dispatch,
        },
    )()
    monkeypatch.setattr(connect, "get_connect", lambda *_: client)
    target = {"name": "sink", "connectName": "connect"}
    if action == "connector.task.restart":
        target["taskId"] = 2
    op = await prepare_operation(request_for(app), OPERATOR, "investigation", "test", action, target, {})
    assert op["requiresConfirmation"] is False
    result = await execute(app, op)
    assert result["status"] == "succeeded"
    dispatch.assert_awaited_once()


async def test_should_report_per_key_partial_configuration_outcome(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    original = admin.alter_configs

    async def partial(kind: str, name: str, configs: dict[str, Any]) -> Any:
        return await original(kind, name, {"retention.ms": configs["retention.ms"]})

    monkeypatch.setattr(admin, "alter_configs", partial)
    op = await prepare(
        app, "topic.config.update", parameters={"configs": {"retention.ms": 86400000, "segment.ms": 3600000}}
    )
    result = await execute(app, op)
    assert result["status"] == "partially_completed"
    assert result["after"]["configs"]["retention.ms"] == "86400000"
    assert result["after"]["configs"]["segment.ms"] is None


async def test_should_reject_erroneous_or_unresolved_offset_preview(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    import k_shui.agent.operations as operations
    from k_shui.api.schemas.group import ResetOffsetResult

    admin.groups["app-consumers"]["state"] = "empty"
    admin.groups["app-consumers"]["members"] = []
    monkeypatch.setattr(
        operations,
        "reset_offsets",
        AsyncMock(
            return_value=[
                ResetOffsetResult(topic="orders", partition=0, newOffset=None, error="upstream failed")
            ]
        ),
    )
    with pytest.raises(Conflict, match="unresolved"):
        await prepare(app, "group.offsets.reset", "app-consumers", {"strategy": "earliest"})


async def test_should_stop_before_dispatch_when_audit_transaction_fails(
    app: Any, admin: Any, monkeypatch: Any
) -> None:
    from contextlib import asynccontextmanager

    from k_shui.agent import operations

    op = await prepare(app, "topic.delete")
    original_scope = db_session.session_scope
    dispatch = AsyncMock()
    monkeypatch.setattr(admin, "delete_topic", dispatch)

    @asynccontextmanager
    async def unavailable_audit() -> Any:
        async with original_scope() as session:
            original_add = session.add

            def fail_audit(instance: Any, **kwargs: Any) -> None:
                if isinstance(instance, AuditLog):
                    raise RuntimeError("audit database unavailable")
                original_add(instance, **kwargs)

            session.add = fail_audit
            yield session

    monkeypatch.setattr(operations.db_session, "session_scope", unavailable_audit)
    with pytest.raises(RuntimeError, match="audit database unavailable"):
        await execute(app, op, "orders")
    dispatch.assert_not_awaited()


async def test_should_cancel_all_pending_operations_beyond_display_page(app: Any) -> None:
    from k_shui.agent.operations import cancel_investigation_operations

    async with db_session.session_scope() as session:
        for index in range(105):
            session.add(
                AgentOperation(
                    id=f"queued-{index}",
                    investigation_id="investigation",
                    user="operator",
                    cluster_id="test",
                    status="prepared",
                    expires_at=9999999999,
                    body={},
                )
            )
        session.add(
            AgentOperation(
                id="accepted",
                investigation_id="investigation",
                user="operator",
                cluster_id="test",
                status="running",
                expires_at=9999999999,
                body={},
            )
        )
    await cancel_investigation_operations(request_for(app), OPERATOR, "investigation", "test")
    async with db_session.session_scope() as session:
        rows = (await session.execute(select(AgentOperation))).scalars().all()
    assert sum(row.status == "cancelled" for row in rows) == 105
    assert next(row for row in rows if row.id == "accepted").status == "running"


async def test_should_hide_upstream_error_body_during_preview(app: Any, admin: Any, monkeypatch: Any) -> None:
    from k_shui.core.errors import UpstreamError

    monkeypatch.setattr(
        admin, "describe_topic", AsyncMock(side_effect=UpstreamError("password=SECRET payload=PRIVATE"))
    )
    with pytest.raises(Conflict) as failure:
        await prepare(app, "topic.delete")
    assert "SECRET" not in str(failure.value) and "PRIVATE" not in str(failure.value)
