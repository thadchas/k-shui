"""CRUD for alert triggers, actions and history.

Backed by the shared SQLAlchemy database when it is initialised; otherwise everything
lives in bounded in-memory tables so the alerts UI still works (for example in tests or
when running with ``--no-db``).
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from typing import Any

from k_shui.core.errors import NotFound
from k_shui.integrations import store as shared_store
from k_shui.integrations.alerts.models import AlertAction, AlertHistory, AlertTrigger
from k_shui.integrations.memstore import Table

_triggers = Table()
_actions = Table()
_history = Table()

TRIGGER_DEFAULTS = {
    "component": "cluster",
    "metric": "underReplicatedPartitions",
    "condition": "gt",
    "value": 0.0,
    "bufferSeconds": 0,
    "severity": "warning",
    "enabled": True,
}


def new_id() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _scope() -> Any:
    """The shared DB session context manager, or ``None`` when there is no database."""
    return shared_store.session_scope()


def _dump(model: Any) -> dict[str, Any]:
    if hasattr(model, "to_dict"):
        return dict(model.to_dict())
    return {"id": getattr(model, "id", None)}


# ------------------------------------------------------------------ field mapping

TRIGGER_FIELDS = {
    "name": "name",
    "clusterId": "cluster_id",
    "component": "component",
    "target": "target",
    "metric": "metric",
    "condition": "condition",
    "value": "value",
    "bufferSeconds": "buffer_seconds",
    "severity": "severity",
    "enabled": "enabled",
    "actionIds": "action_ids",
    "config": "config",
}
ACTION_FIELDS = {"name": "name", "type": "type", "config": "config", "enabled": "enabled"}


def _apply(model: Any, payload: dict[str, Any], mapping: dict[str, str]) -> None:
    for api_name, column in mapping.items():
        if api_name in payload and payload[api_name] is not None:
            setattr(model, column, payload[api_name])


def _memory_row(payload: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    row = {**defaults, **{k: v for k, v in payload.items() if v is not None}}
    row.setdefault("id", new_id())
    row.setdefault("createdAt", _now_iso())
    row["updatedAt"] = _now_iso()
    return row


# ---------------------------------------------------------------------- triggers


async def list_triggers(cluster_id: str | None = None, enabled: bool | None = None) -> list[dict[str, Any]]:
    scope = await _scope()
    if scope is None:
        rows = _triggers.list()
    else:
        from sqlalchemy import select

        async with scope() as session:
            rows = [_dump(m) for m in (await session.execute(select(AlertTrigger))).scalars().all()]
    if cluster_id:
        rows = [r for r in rows if r.get("clusterId") in (None, cluster_id)]
    if enabled is not None:
        rows = [r for r in rows if bool(r.get("enabled")) is enabled]
    return rows


async def get_trigger(trigger_id: str) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _triggers.get(trigger_id)
    else:
        async with scope() as session:
            model = await session.get(AlertTrigger, trigger_id)
            row = _dump(model) if model is not None else None
    if row is None:
        raise NotFound(f"alert trigger '{trigger_id}' not found")
    return row


async def create_trigger(payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        return _triggers.put(_memory_row(payload, {**TRIGGER_DEFAULTS, "target": {}, "actionIds": []}))
    async with scope() as session:
        model = AlertTrigger(id=payload.get("id") or new_id())
        _apply(model, {**TRIGGER_DEFAULTS, **payload}, TRIGGER_FIELDS)
        session.add(model)
        await session.flush()
        return _dump(model)


async def update_trigger(trigger_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _triggers.get(trigger_id)
        if row is None:
            raise NotFound(f"alert trigger '{trigger_id}' not found")
        row.update({k: v for k, v in payload.items() if v is not None})
        row["updatedAt"] = _now_iso()
        return _triggers.put(row)
    async with scope() as session:
        model = await session.get(AlertTrigger, trigger_id)
        if model is None:
            raise NotFound(f"alert trigger '{trigger_id}' not found")
        _apply(model, payload, TRIGGER_FIELDS)
        await session.flush()
        return _dump(model)


async def set_trigger_enabled(trigger_id: str, enabled: bool) -> dict[str, Any]:
    return await update_trigger(trigger_id, {"enabled": enabled})


async def delete_trigger(trigger_id: str) -> None:
    scope = await _scope()
    if scope is None:
        if not _triggers.delete(trigger_id):
            raise NotFound(f"alert trigger '{trigger_id}' not found")
        return
    async with scope() as session:
        model = await session.get(AlertTrigger, trigger_id)
        if model is None:
            raise NotFound(f"alert trigger '{trigger_id}' not found")
        await session.delete(model)


# ----------------------------------------------------------------------- actions


async def list_actions() -> list[dict[str, Any]]:
    scope = await _scope()
    if scope is None:
        return _actions.list()
    from sqlalchemy import select

    async with scope() as session:
        return [_dump(m) for m in (await session.execute(select(AlertAction))).scalars().all()]


async def get_action(action_id: str) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _actions.get(action_id)
    else:
        async with scope() as session:
            model = await session.get(AlertAction, action_id)
            row = _dump(model) if model is not None else None
    if row is None:
        raise NotFound(f"alert action '{action_id}' not found")
    return row


async def create_action(payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        return _actions.put(
            _memory_row(payload, {"type": "webhook", "config": {}, "enabled": True, "name": ""})
        )
    async with scope() as session:
        model = AlertAction(id=payload.get("id") or new_id())
        _apply(model, payload, ACTION_FIELDS)
        session.add(model)
        await session.flush()
        return _dump(model)


async def update_action(action_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _actions.get(action_id)
        if row is None:
            raise NotFound(f"alert action '{action_id}' not found")
        row.update({k: v for k, v in payload.items() if v is not None})
        row["updatedAt"] = _now_iso()
        return _actions.put(row)
    async with scope() as session:
        model = await session.get(AlertAction, action_id)
        if model is None:
            raise NotFound(f"alert action '{action_id}' not found")
        _apply(model, payload, ACTION_FIELDS)
        await session.flush()
        return _dump(model)


async def delete_action(action_id: str) -> None:
    scope = await _scope()
    if scope is None:
        if not _actions.delete(action_id):
            raise NotFound(f"alert action '{action_id}' not found")
        return
    async with scope() as session:
        model = await session.get(AlertAction, action_id)
        if model is None:
            raise NotFound(f"alert action '{action_id}' not found")
        await session.delete(model)


async def actions_for(action_ids: list[str]) -> list[dict[str, Any]]:
    if not action_ids:
        return []
    every = await list_actions()
    by_id = {a["id"]: a for a in every}
    return [by_id[i] for i in action_ids if i in by_id and by_id[i].get("enabled", True)]


# ----------------------------------------------------------------------- history


async def create_history(payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _memory_row(payload, {"status": "firing", "notifications": []})
        row.setdefault("firedAt", _now_iso())
        return _history.put(row)
    async with scope() as session:
        model = AlertHistory(id=payload.get("id") or new_id())
        for api_name, column in (
            ("triggerId", "trigger_id"),
            ("triggerName", "trigger_name"),
            ("component", "component"),
            ("target", "target"),
            ("clusterId", "cluster_id"),
            ("severity", "severity"),
            ("status", "status"),
            ("value", "value"),
            ("threshold", "threshold"),
            ("notifications", "notifications"),
        ):
            if payload.get(api_name) is not None:
                setattr(model, column, payload[api_name])
        session.add(model)
        await session.flush()
        return _dump(model)


async def update_history(history_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        row = _history.get(history_id)
        if row is None:
            raise NotFound(f"alert history '{history_id}' not found")
        row.update({k: v for k, v in payload.items() if v is not None})
        return _history.put(row)
    async with scope() as session:
        model = await session.get(AlertHistory, history_id)
        if model is None:
            raise NotFound(f"alert history '{history_id}' not found")
        for api_name, column in (
            ("status", "status"),
            ("value", "value"),
            ("notifications", "notifications"),
            ("resolvedAt", "resolved_at"),
            ("ackedAt", "acked_at"),
            ("ackedBy", "acked_by"),
        ):
            if payload.get(api_name) is not None:
                setattr(model, column, payload[api_name])
        await session.flush()
        return _dump(model)


async def list_history(
    status: str | None = None,
    component: str | None = None,
    cluster_id: str | None = None,
    since: float | None = None,
    trigger_id: str | None = None,
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    scope = await _scope()
    if scope is None:
        rows = sorted(_history.list(), key=lambda r: str(r.get("firedAt", "")), reverse=True)
    else:
        from sqlalchemy import select

        async with scope() as session:
            stmt = select(AlertHistory).order_by(AlertHistory.fired_at.desc())
            rows = [_dump(m) for m in (await session.execute(stmt)).scalars().all()]
    if status:
        rows = [r for r in rows if r.get("status") == status]
    if component:
        rows = [r for r in rows if r.get("component") == component]
    if cluster_id:
        rows = [r for r in rows if r.get("clusterId") == cluster_id]
    if trigger_id:
        rows = [r for r in rows if r.get("triggerId") == trigger_id]
    if since:
        cutoff = datetime.fromtimestamp(since, UTC).isoformat()
        rows = [r for r in rows if str(r.get("firedAt", "")) >= cutoff]
    total = len(rows)
    start = max(page - 1, 0) * per_page
    return {"items": rows[start : start + per_page], "page": page, "perPage": per_page, "total": total}


async def find_open(trigger_id: str, target: str | None) -> dict[str, Any] | None:
    result = await list_history(status="firing", trigger_id=trigger_id, per_page=200)
    return next((r for r in result["items"] if r.get("target") == target), None)


async def ack_history(history_id: str, user: str | None = None) -> dict[str, Any]:
    return await update_history(history_id, {"ackedAt": datetime.now(UTC), "ackedBy": user or "anonymous"})


async def summary(cluster_id: str | None = None) -> dict[str, Any]:
    firing = await list_history(status="firing", cluster_id=cluster_id, per_page=1000)
    by_severity: dict[str, int] = {"critical": 0, "warning": 0, "info": 0}
    by_cluster: dict[str, int] = {}
    unacked = 0
    for row in firing["items"]:
        severity = str(row.get("severity", "warning"))
        by_severity[severity] = by_severity.get(severity, 0) + 1
        key = str(row.get("clusterId") or "-")
        by_cluster[key] = by_cluster.get(key, 0) + 1
        if not row.get("ackedAt"):
            unacked += 1
    triggers = await list_triggers()
    return {
        "firing": firing["total"],
        "unacknowledged": unacked,
        "bySeverity": by_severity,
        "byCluster": by_cluster,
        "triggers": len(triggers),
        "enabledTriggers": sum(1 for t in triggers if t.get("enabled")),
        "ts": time.time(),
    }


def reset_memory() -> None:
    """Clear the in-memory tables (used by tests)."""
    _triggers.clear()
    _actions.clear()
    _history.clear()
