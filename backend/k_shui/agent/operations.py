"""Persisted exact-effect operations; model tools can prepare, never execute.

A committed compare-and-set claim precedes upstream mutation. Ambiguous requests are
never retried: callers receive outcome_unknown and must inspect upstream state. Every
state transition and before/after evidence is persisted with its audit entry atomically.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import JSON, Float, String, select, update
from sqlalchemy.orm import Mapped, mapped_column

from k_shui.agent.tools import SAFE_CONFIGS, SENSITIVE, bounded_data, check_authority, resource_link
from k_shui.api.routers.consumer_groups import reset_offsets
from k_shui.api.schemas.group import ResetOffsetsRequest
from k_shui.core.auth import Principal
from k_shui.core.errors import BadRequest, Conflict, Forbidden, NotFound
from k_shui.core.registry import ClusterContext
from k_shui.db import session as db_session
from k_shui.db.models import AuditLog, Base
from k_shui.kafka.admin import KafkaAdmin

CONSEQUENTIAL = frozenset({"topic.delete", "topic.purge", "topic.partitions.increase", "group.offsets.reset"})
ACTIONS = (
    frozenset(
        {
            "topic.create",
            "topic.config.update",
            "connector.pause",
            "connector.resume",
            "connector.restart",
            "connector.task.restart",
        }
    )
    | CONSEQUENTIAL
)
PENDING = ("prepared", "awaiting_confirmation")
MAX_PARTITIONS = 1000


class AgentOperation(Base):
    __tablename__ = "agent_operations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    investigation_id: Mapped[str] = mapped_column(String(64), index=True)
    user: Mapped[str] = mapped_column(String(200), index=True)
    cluster_id: Mapped[str] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True)
    expires_at: Mapped[float] = mapped_column(Float)
    body: Mapped[dict[str, Any]] = mapped_column(JSON)


OPERATION_DEFINITION = {
    "type": "function",
    "function": {
        "name": "prepare_operation",
        "description": (
            "Prepare an exact Kafka operation only when the human explicitly requested that action. "
            "Does not execute; user reviews and executes in K-Shui. "
            "Never infer mutation intent from a diagnostic question."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["action", "target", "parameters"],
            "properties": {
                "action": {"type": "string", "enum": sorted(ACTIONS)},
                "target": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name"],
                    "properties": {
                        "name": {"type": "string"},
                        "connectName": {"type": "string"},
                        "taskId": {"type": "integer"},
                    },
                },
                "parameters": {
                    "type": "object",
                    "description": (
                        "create: partitions,replicationFactor,configs; config.update: configs; "
                        "partitions.increase: count; offsets.reset: topic,partitions,strategy,value; "
                        "restart: includeTasks,onlyFailed; otherwise empty"
                    ),
                },
            },
        },
    },
}


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _validate(
    action: str, target: dict[str, Any], parameters: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    if action not in ACTIONS:
        raise BadRequest("operation is not supported by K-Shui Agent")
    if not isinstance(target, dict) or not isinstance(parameters, dict):
        raise BadRequest("target and parameters must be objects")
    expected_target = {"name"} | ({"connectName"} if action.startswith("connector.") else set())
    if action == "connector.task.restart":
        expected_target.add("taskId")
    if set(target) != expected_target:
        raise BadRequest("unexpected or missing target fields")
    for key in expected_target - {"taskId"}:
        value = target[key]
        if not isinstance(value, str) or not value or len(value) > 249 or any(c in value for c in "\r\n\x00"):
            raise BadRequest("target identifiers must be nonempty and at most 249 characters")
    if any(SENSITIVE.search(str(value)) or "://" in str(value) for value in target.values()):
        raise BadRequest("secret-like target identifiers are outside agent data policy")
    if action.startswith("topic.") and not re.fullmatch(r"[a-zA-Z0-9._-]+", target["name"]):
        raise BadRequest("invalid Kafka topic name")
    if action.startswith("topic.") and (target["name"].startswith("__") or target["name"] in (".", "..")):
        raise BadRequest("internal and reserved topics are outside agent operation policy")
    if "taskId" in target and (type(target["taskId"]) is not int or target["taskId"] < 0):
        raise BadRequest("taskId must be a nonnegative integer")
    keys = {
        "topic.create": {"partitions", "replicationFactor", "configs"},
        "topic.config.update": {"configs"},
        "topic.partitions.increase": {"count"},
        "group.offsets.reset": {"topic", "partitions", "strategy", "value"},
        "connector.restart": {"includeTasks", "onlyFailed"},
    }.get(action, set())
    if set(parameters) - keys:
        raise BadRequest("unexpected operation parameters")
    params = dict(parameters)
    if action == "topic.create":
        params.setdefault("partitions", 1)
        params.setdefault("replicationFactor", 1)
        params.setdefault("configs", {})
        if type(params["replicationFactor"]) is not int or not 1 <= params["replicationFactor"] <= 100:
            raise BadRequest("replicationFactor must be between 1 and 100")
    for key in ("partitions", "count"):
        if (
            action != "group.offsets.reset"
            and key in params
            and (type(params[key]) is not int or not 1 <= params[key] <= MAX_PARTITIONS)
        ):
            raise BadRequest(f"{key} must be between 1 and {MAX_PARTITIONS}")
    if action == "topic.partitions.increase" and "count" not in params:
        raise BadRequest("count is required")
    if "configs" in params or action == "topic.config.update":
        configs = params.get("configs")
        if not isinstance(configs, dict) or set(configs) - SAFE_CONFIGS or len(configs) > 20:
            raise BadRequest("only supported non-secret topic configuration keys are allowed")
        if action == "topic.config.update" and not configs:
            raise BadRequest("at least one configuration change is required")
        if any(
            not isinstance(v, str | int) or isinstance(v, bool) or len(str(v)) > 80 for v in configs.values()
        ):
            raise BadRequest("configuration values must be bounded strings or integers")
        numeric = SAFE_CONFIGS - {"cleanup.policy", "compression.type", "message.timestamp.type"}
        for key, value in configs.items():
            text = str(value)
            if key in numeric and not re.fullmatch(r"-?\d{1,18}", text):
                raise BadRequest("numeric topic configuration expected")
            if key == "cleanup.policy" and text not in (
                "delete",
                "compact",
                "compact,delete",
                "delete,compact",
            ):
                raise BadRequest("invalid cleanup policy")
            if key == "compression.type" and text not in (
                "producer",
                "uncompressed",
                "gzip",
                "snappy",
                "lz4",
                "zstd",
            ):
                raise BadRequest("invalid compression type")
            if key == "message.timestamp.type" and text not in ("CreateTime", "LogAppendTime"):
                raise BadRequest("invalid timestamp type")
        params["configs"] = {k: str(v) for k, v in configs.items()}
    for key in ("includeTasks", "onlyFailed"):
        if key in params and type(params[key]) is not bool:
            raise BadRequest(f"{key} must be a boolean")
    if action == "group.offsets.reset":
        if "partitions" in params and (
            not isinstance(params["partitions"], list)
            or not params["partitions"]
            or len(params["partitions"]) > MAX_PARTITIONS
            or any(type(p) is not int or p < 0 for p in params["partitions"])
        ):
            raise BadRequest("partitions must be a bounded nonempty list of nonnegative integers")
        if "topic" in params and (
            not isinstance(params["topic"], str) or not re.fullmatch(r"[\w.-]{1,249}", params["topic"])
        ):
            raise BadRequest("invalid reset topic")
        if params.get("topic", "").startswith("__"):
            raise BadRequest("internal topics are outside agent operation policy")
        if "value" in params and type(params["value"]) is not int:
            raise BadRequest("reset value must be an integer")
        try:
            body = ResetOffsetsRequest(**params, dryRun=True)
        except ValueError as exc:
            raise BadRequest("invalid offset reset parameters") from exc
        if body.strategy in ("offset", "timestamp", "shiftBy") and body.value is None:
            raise BadRequest("reset strategy requires value")
        params = body.model_dump(exclude={"dryRun"}, exclude_none=True)
    return dict(target), params


async def _snapshot(
    request: Request,
    principal: Principal,
    ctx: ClusterContext,
    action: str,
    target: dict[str, Any],
    params: dict[str, Any],
) -> tuple[Any, Any]:
    admin = KafkaAdmin.get(ctx)
    name = target["name"]
    if action == "topic.create":
        topics = await admin.list_topics()
        if any(t["name"] == name for t in topics):
            raise Conflict("topic already exists; prepare a different operation")
        cluster = await admin.describe_cluster()
        if params["replicationFactor"] > cluster.get("brokerCount", 0):
            raise BadRequest("replication factor exceeds available brokers")
        return {"exists": False, "brokerCount": cluster.get("brokerCount")}, {
            "create": {"name": name, **params}
        }
    if action.startswith("topic."):
        detail = await admin.describe_topic(name)
        if detail.get("isInternal"):
            raise BadRequest("internal topics are outside agent operation policy")
        partition_ids = [p["id"] for p in detail["partitionsDetail"]]
        if len(partition_ids) > MAX_PARTITIONS:
            raise BadRequest("topic exceeds the agent partition limit")
        before = {
            "partitions": detail["partitions"],
            "replicationFactor": detail["replicationFactor"],
            "partitionAssignments": [
                {k: p.get(k) for k in ("id", "replicas")} for p in detail["partitionsDetail"]
            ],
        }
        if action == "topic.config.update":
            entries = await admin.describe_configs("topic", name)
            values = {e["name"]: e.get("value") for e in entries}
            before["configs"] = {k: values.get(k) for k in params["configs"]}
            return before, {
                "changes": [
                    {"key": k, "before": before["configs"][k], "after": v}
                    for k, v in params["configs"].items()
                ]
            }
        if action == "topic.partitions.increase":
            if params["count"] <= detail["partitions"]:
                raise BadRequest("new partition count must exceed the current count")
            return before, {
                "beforeCount": detail["partitions"],
                "afterCount": params["count"],
                "warning": (
                    "Irreversible. New records may map keys to different partitions; "
                    "consumers will rebalance."
                ),
            }
        marks = await admin.watermarks([(name, p) for p in partition_ids])
        if any((name, p) not in marks for p in partition_ids):
            raise Conflict("missing watermarks; cannot prepare concrete impact")
        before["offsets"] = [
            {"partition": p, "low": marks[(name, p)][0], "high": marks[(name, p)][1]} for p in partition_ids
        ]
        if action == "topic.delete":
            return before, {
                "delete": name,
                "partitions": detail["partitions"],
                "recordsAtPreview": sum(max(v[1] - v[0], 0) for v in marks.values()),
                "warning": "Irreversible topic and record deletion. Producers and consumers may fail.",
            }
        return before, {
            "offsets": [
                {"topic": name, "partition": p, "beforeOffset": marks[(name, p)][1]} for p in partition_ids
            ],
            "warning": "Irreversible. Deletes only records before the exact previewed offsets.",
        }
    if action == "group.offsets.reset":
        group = (await admin.describe_groups([name])).get(name)
        if not group or group.get("error"):
            raise NotFound("consumer group not found")
        if group.get("members") or str(group.get("state", "")).lower() not in ("empty", "dead"):
            raise Conflict("stop group consumers before preparing an offset reset")
        plan = await reset_offsets(name, ResetOffsetsRequest(**params, dryRun=True), request, ctx, principal)
        if not plan or len(plan) > MAX_PARTITIONS:
            raise BadRequest("offset reset plan is empty or exceeds partition limit")
        if any(p.topic.startswith("__") for p in plan):
            raise BadRequest("internal topics are outside agent operation policy")
        if any(p.error or type(p.newOffset) is not int or p.newOffset < 0 for p in plan):
            raise Conflict("offset preview contains errors or unresolved offsets")
        marks = await admin.watermarks([(p.topic, p.partition) for p in plan])
        if any(
            (p.topic, p.partition) not in marks
            or not marks[(p.topic, p.partition)][0] <= p.newOffset <= marks[(p.topic, p.partition)][1]
            for p in plan
        ):
            raise Conflict("offset preview lacks valid current watermarks")
        rows = [p.model_dump(exclude={"error"}) for p in plan]
        return {"state": group["state"], "offsets": rows}, {
            "dryRun": True,
            "offsets": rows,
            "warning": (
                "Offset changes may skip or replay records. Keep consumers stopped until verification."
            ),
        }
    from k_shui.integrations.connect import get_connect

    status = await get_connect(ctx, target["connectName"]).status(name)
    before = {
        "connector": {"state": status.get("connector", {}).get("state")},
        "tasks": [{"id": t.get("id"), "state": t.get("state")} for t in status.get("tasks", [])],
    }
    if action == "connector.task.restart" and not any(t["id"] == target["taskId"] for t in before["tasks"]):
        raise NotFound("connector task not found")
    return before, {
        "action": action,
        "target": target,
        "parameters": params,
        "warning": "May briefly interrupt processing.",
    }


async def _safe_snapshot(
    request: Request,
    principal: Principal,
    ctx: ClusterContext,
    action: str,
    target: dict[str, Any],
    params: dict[str, Any],
) -> tuple[Any, Any]:
    try:
        async with asyncio.timeout(20):
            return await _snapshot(request, principal, ctx, action, target, params)
    except (BadRequest, Conflict):
        raise
    except NotFound as exc:
        raise NotFound("requested resource was not found") from exc
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Integration error bodies may embed credentials or connector record contents.
        raise Conflict("resource state unavailable; retry the preview after checking connectivity") from exc


def _public(row: AgentOperation) -> dict[str, Any]:
    return {**row.body, "status": row.status}


async def _persist(row: AgentOperation, *, add: bool = False) -> None:
    # Fail closed if the audit cannot be durably written.
    async with db_session.session_scope() as session:
        if add:
            session.add(row)
        else:
            await session.execute(
                update(AgentOperation)
                .where(AgentOperation.id == row.id)
                .values(status=row.status, body=row.body)
            )
        session.add(
            AuditLog(
                user=row.user,
                action="agent." + row.body["action"] + "." + row.status,
                cluster_id=row.cluster_id,
                resource=row.body["target"]["name"],
                details={
                    "origin": "agent",
                    "operationId": row.id,
                    "investigationId": row.investigation_id,
                    "parameters": row.body["parameters"],
                    "before": row.body.get("before"),
                    "after": row.body.get("after"),
                    "confirmation": row.body.get("confirmedAt"),
                    "result": row.status,
                },
            )
        )


async def prepare_operation(
    request: Request,
    principal: Principal,
    investigation_id: str,
    cluster_id: str,
    action: str,
    target: dict[str, Any],
    parameters: dict[str, Any],
) -> dict[str, Any]:
    fresh, ctx = await check_authority(request, principal, cluster_id, mutation=True)
    target, params = _validate(action, target, parameters)
    before, preview = await _safe_snapshot(request, fresh, ctx, action, target, params)
    if bounded_data(before) != before or bounded_data(preview) != preview:
        raise BadRequest("operation evidence contains unsupported, sensitive or excessive metadata")
    now = time.time()
    operation_id = uuid.uuid4().hex
    kind = "topic" if action.startswith("topic.") else "group" if action.startswith("group.") else "connector"
    body = {
        "id": operation_id,
        "investigationId": investigation_id,
        "clusterId": cluster_id,
        "user": fresh.username,
        "action": action,
        "target": target,
        "parameters": params,
        "before": before,
        "preview": preview,
        "after": None,
        "requiresConfirmation": action in CONSEQUENTIAL,
        "confirmationText": target["name"] if action in CONSEQUENTIAL else None,
        "createdAt": datetime.fromtimestamp(now, UTC).isoformat(),
        "expiresAt": datetime.fromtimestamp(now + 300, UTC).isoformat(),
        "href": resource_link(cluster_id, kind, target["name"], target.get("connectName", "")),
    }
    row = AgentOperation(
        id=operation_id,
        investigation_id=investigation_id,
        cluster_id=cluster_id,
        user=fresh.username,
        status="awaiting_confirmation" if action in CONSEQUENTIAL else "prepared",
        expires_at=now + 300,
        body=body,
    )
    await _persist(row, add=True)
    return _public(row)


async def _load(
    operation_id: str, principal: Principal, investigation_id: str, cluster_id: str
) -> AgentOperation:
    async with db_session.session_scope() as session:
        row = await session.get(AgentOperation, operation_id)
        if row is None:
            raise NotFound("operation not found")
        if (
            row.user != principal.username
            or row.investigation_id != investigation_id
            or row.cluster_id != cluster_id
        ):
            raise Forbidden("operation belongs to a different user or investigation scope")
        return row


async def list_operations(
    request: Request, principal: Principal, investigation_id: str, cluster_id: str
) -> list[dict[str, Any]]:
    await check_authority(request, principal, cluster_id)
    async with db_session.session_scope() as session:
        rows = (
            (
                await session.execute(
                    select(AgentOperation)
                    .where(
                        AgentOperation.user == principal.username,
                        AgentOperation.investigation_id == investigation_id,
                        AgentOperation.cluster_id == cluster_id,
                    )
                    .order_by(AgentOperation.expires_at.desc())
                    .limit(100)
                )
            )
            .scalars()
            .all()
        )
        return [_public(row) for row in rows]


async def cancel_operation(
    request: Request, principal: Principal, investigation_id: str, cluster_id: str, operation_id: str
) -> dict[str, Any]:
    await check_authority(request, principal, cluster_id)
    row = await _load(operation_id, principal, investigation_id, cluster_id)
    async with db_session.session_scope() as session:
        result = await session.execute(
            update(AgentOperation)
            .where(AgentOperation.id == row.id, AgentOperation.status.in_(PENDING))
            .values(status="cancelled")
        )
        if result.rowcount:
            session.add(
                AuditLog(
                    user=row.user,
                    action="agent.operation.cancelled",
                    cluster_id=cluster_id,
                    resource=row.body["target"]["name"],
                    details={"origin": "agent", "operationId": row.id},
                )
            )
    return _public(await _load(operation_id, principal, investigation_id, cluster_id))


async def execute_operation(
    request: Request,
    principal: Principal,
    investigation_id: str,
    cluster_id: str,
    operation_id: str,
    confirmation: str | None = None,
) -> dict[str, Any]:
    fresh, ctx = await check_authority(request, principal, cluster_id, mutation=True)
    row = await _load(operation_id, fresh, investigation_id, cluster_id)
    if row.status not in PENDING:
        # Running after process interruption is uncertain, never eligible for redispatch.
        result = _public(row)
        if row.status in ("running", "verifying"):
            result["detail"] = (
                "Execution accepted; outcome may still be pending. Do not retry as a new operation."
            )
        return result
    if row.expires_at <= time.time():
        raise Conflict("operation preview expired; prepare a new preview")
    if row.body["requiresConfirmation"] and confirmation != row.body["confirmationText"]:
        raise BadRequest("type the exact resource name to confirm this preview")
    action, target, params = row.body["action"], row.body["target"], row.body["parameters"]
    before, preview = await _safe_snapshot(request, fresh, ctx, action, target, params)
    if _fingerprint(before) != _fingerprint(row.body["before"]) or _fingerprint(preview) != _fingerprint(
        row.body["preview"]
    ):
        raise Conflict("resource state changed; prepare and confirm a new preview")
    fresh, ctx = await check_authority(request, principal, cluster_id, mutation=True)
    if row.expires_at <= time.time():
        raise Conflict("operation preview expired; prepare a new preview")
    row.body = {
        **row.body,
        "confirmedAt": datetime.now(UTC).isoformat() if row.body["requiresConfirmation"] else None,
    }
    # CAS + durable audit before sending anything to Kafka/Connect, across worker processes.
    async with db_session.session_scope() as session:
        result = await session.execute(
            update(AgentOperation)
            .where(AgentOperation.id == row.id, AgentOperation.status.in_(PENDING))
            .values(status="running", body=row.body)
        )
        if not result.rowcount:
            claimed = False
        else:
            claimed = True
            session.add(
                AuditLog(
                    user=row.user,
                    action="agent." + action + ".running",
                    cluster_id=cluster_id,
                    resource=target["name"],
                    details={
                        "origin": "agent",
                        "operationId": row.id,
                        "parameters": params,
                        "confirmation": row.body["confirmedAt"],
                        "before": before,
                    },
                )
            )
    if not claimed:
        return _public(await _load(operation_id, fresh, investigation_id, cluster_id))
    row.status = "running"
    try:
        fresh, ctx = await check_authority(request, principal, cluster_id, mutation=True)
        async with asyncio.timeout(30):
            applied = await _dispatch(ctx, action, target, params, row.body["preview"])
        row.status = "verifying"
        await _persist(row)
        await check_authority(request, principal, cluster_id, mutation=True)
        async with asyncio.timeout(15):
            status, after = await _verify(ctx, action, target, params, row.body["preview"], applied)
        row.status = status
        row.body = {**row.body, "after": bounded_data(after), "verifiedAt": datetime.now(UTC).isoformat()}
    except asyncio.CancelledError:
        row.status = "outcome_unknown"
        row.body = {
            **row.body,
            "error": "Execution interrupted after acceptance. Reconcile upstream state; no automatic retry.",
        }
        await asyncio.shield(_persist(row))
        raise
    except Exception:
        row.status = "outcome_unknown"
        row.body = {
            **row.body,
            "error": (
                "Upstream execution or verification did not complete. "
                "Inspect the resource before preparing another operation."
            ),
        }
    await _persist(row)
    return _public(row)


async def _dispatch(
    ctx: ClusterContext, action: str, target: dict[str, Any], params: dict[str, Any], preview: dict[str, Any]
) -> Any:
    admin = KafkaAdmin.get(ctx)
    name = target["name"]
    if action == "topic.create":
        return await admin.create_topic(
            name, params["partitions"], params["replicationFactor"], params["configs"]
        )
    if action == "topic.config.update":
        return await admin.alter_configs("topic", name, params["configs"])
    if action == "topic.delete":
        return await admin.delete_topic(name)
    if action == "topic.partitions.increase":
        return await admin.create_partitions(name, params["count"])
    if action == "topic.purge":
        return await admin.delete_records(
            [(r["topic"], r["partition"], r["beforeOffset"]) for r in preview["offsets"]]
        )
    if action == "group.offsets.reset":
        return await admin.alter_group_offsets(
            name, [(r["topic"], r["partition"], r["newOffset"]) for r in preview["offsets"]]
        )
    from k_shui.integrations.connect import get_connect

    client = get_connect(ctx, target["connectName"])
    if action == "connector.task.restart":
        return await client.restart_task(name, target["taskId"])
    if action == "connector.restart":
        return await client.restart(
            name, include_tasks=params.get("includeTasks", False), only_failed=params.get("onlyFailed", False)
        )
    if action == "connector.pause":
        return await client.pause(name)
    if action == "connector.resume":
        return await client.resume(name)
    raise BadRequest("unsupported operation")


async def _verify(
    ctx: ClusterContext,
    action: str,
    target: dict[str, Any],
    params: dict[str, Any],
    preview: dict[str, Any],
    applied: Any,
) -> tuple[str, Any]:
    admin = KafkaAdmin.get(ctx)
    name = target["name"]
    if action == "topic.delete":
        exists = any(t["name"] == name for t in await admin.list_topics())
        return ("outcome_unknown" if exists else "succeeded"), {"exists": exists}
    if action in ("topic.create", "topic.partitions.increase"):
        detail = await admin.describe_topic(name)
        ok = detail["partitions"] == params.get("partitions", params.get("count"))
        if action == "topic.create":
            ok = ok and detail["replicationFactor"] == params["replicationFactor"]
            entries = await admin.describe_configs("topic", name)
            actual = {e["name"]: e.get("value") for e in entries}
            ok = ok and all(actual.get(k) == v for k, v in params["configs"].items())
        return ("succeeded" if ok else "outcome_unknown"), detail
    if action == "topic.config.update":
        actual = {e["name"]: e.get("value") for e in await admin.describe_configs("topic", name)}
        matched = [actual.get(k) == v for k, v in params["configs"].items()]
        status = "succeeded" if all(matched) else "partially_completed" if any(matched) else "outcome_unknown"
        return status, {"configs": {k: actual.get(k) for k in params["configs"]}}
    if action in ("topic.purge", "group.offsets.reset"):
        planned = preview["offsets"]
        if action == "topic.purge":
            marks = await admin.watermarks([(r["topic"], r["partition"]) for r in planned])
            actual = {key: value[0] for key, value in marks.items()}
            matched = [actual.get((r["topic"], r["partition"]), -1) >= r["beforeOffset"] for r in planned]
        else:
            actual = {(r["topic"], r["partition"]): r["offset"] for r in await admin.group_offsets(name)}
            matched = [actual.get((r["topic"], r["partition"])) == r["newOffset"] for r in planned]
        status = "succeeded" if all(matched) else "partially_completed" if any(matched) else "outcome_unknown"
        return status, {
            "partitions": [
                {
                    "topic": r["topic"],
                    "partition": r["partition"],
                    "offset": actual.get((r["topic"], r["partition"])),
                    "verified": match,
                }
                for r, match in zip(planned, matched, strict=True)
            ]
        }
    from k_shui.integrations.connect import get_connect

    result = await get_connect(ctx, target["connectName"]).status(name)
    expected = "PAUSED" if action == "connector.pause" else "RUNNING"
    if action == "connector.task.restart":
        states = [t.get("state") for t in result.get("tasks", []) if t.get("id") == target["taskId"]]
    else:
        states = [result.get("connector", {}).get("state")]
        if action == "connector.restart" and params.get("includeTasks"):
            states += [t.get("state") for t in result.get("tasks", [])]
    ok = bool(states) and all(str(s).upper() == expected for s in states)
    return ("succeeded" if ok else "outcome_unknown"), result


async def cancel_investigation_operations(
    request: Request, principal: Principal, investigation_id: str, cluster_id: str
) -> None:
    """Cancel all prepared work; accepted upstream requests cannot be undone."""
    await check_authority(request, principal, cluster_id)
    async with db_session.session_scope() as session:
        result = await session.execute(
            update(AgentOperation)
            .where(
                AgentOperation.user == principal.username,
                AgentOperation.investigation_id == investigation_id,
                AgentOperation.cluster_id == cluster_id,
                AgentOperation.status.in_(PENDING),
            )
            .values(status="cancelled")
        )
        if result.rowcount:
            session.add(
                AuditLog(
                    user=principal.username,
                    action="agent.operations.cancelled",
                    cluster_id=cluster_id,
                    resource=investigation_id,
                    details={
                        "origin": "agent",
                        "investigationId": investigation_id,
                        "count": result.rowcount,
                    },
                )
            )


async def recover_interrupted_operations() -> None:
    """On restart, mark abandoned mutations uncertain without sending an upstream request."""
    async with db_session.session_scope() as session:
        rows = (
            (
                await session.execute(
                    select(AgentOperation).where(AgentOperation.status.in_(("running", "verifying")))
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            row.status = "outcome_unknown"
            row.body = {
                **row.body,
                "error": (
                    "Server restarted during execution. Inspect upstream state; do not automatically retry."
                ),
            }
            session.add(
                AuditLog(
                    user=row.user,
                    action="agent.operation.outcome_unknown",
                    cluster_id=row.cluster_id,
                    resource=row.body["target"]["name"],
                    details={"origin": "agent", "operationId": row.id, "reason": "server_restart"},
                )
            )
