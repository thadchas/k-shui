"""Alerting endpoints (`/alerts/...`) — triggers, actions, history, summary, catalog."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.schemas.alerts import (
    Action,
    ActionPatch,
    ActionWrite,
    AlertSummary,
    HistoryEntry,
    HistoryPage,
    MetricCatalogEntry,
    TestActionResult,
    Trigger,
    TriggerPatch,
    TriggerWrite,
)
from k_shui.core.errors import BadRequest
from k_shui.core.registry import ClusterRegistry, get_registry
from k_shui.integrations.alerts import engine as alert_engine
from k_shui.integrations.alerts import metrics_catalog, notifiers, store
from k_shui.integrations.audit import audit

router = APIRouter(prefix="/alerts", tags=["alerts"])


async def _engine(request: Request) -> Any:
    """Lazily start the engine so alerting works even if main.py never called setup()."""
    return await alert_engine.ensure_started(request.app)


# ---------------------------------------------------------------------- triggers


@router.get("/triggers", response_model=list[Trigger])
async def list_triggers(
    request: Request,
    clusterId: str | None = Query(None),
    enabled: bool | None = Query(None),
) -> Any:
    await _engine(request)
    return await store.list_triggers(cluster_id=clusterId, enabled=enabled)


@router.post("/triggers", response_model=Trigger, status_code=201)
async def create_trigger(
    request: Request,
    body: TriggerWrite,
    registry: ClusterRegistry = Depends(get_registry),
) -> Any:
    _validate(body.component, body.metric, registry, body.clusterId)
    payload = body.model_dump()
    payload["target"] = {k: v for k, v in (payload.get("target") or {}).items() if v is not None}
    trigger = await store.create_trigger(payload)
    await audit(request, "alert.trigger.create", f"alerts/triggers/{trigger['id']}", payload)
    await _engine(request)
    return trigger


@router.get("/metrics", response_model=list[MetricCatalogEntry])
async def metric_catalog() -> Any:
    return metrics_catalog.as_list()


@router.get("/summary", response_model=AlertSummary)
async def summary(request: Request, clusterId: str | None = Query(None)) -> Any:
    await _engine(request)
    return await store.summary(clusterId)


@router.get("/status")
async def engine_status(request: Request) -> dict[str, Any]:
    engine = await _engine(request)
    return engine.status() if engine is not None else {"running": False}


@router.post("/evaluate")
async def evaluate_now(request: Request) -> dict[str, Any]:
    """Force an immediate evaluation pass (useful for testing a new trigger)."""
    engine = await _engine(request)
    if engine is None:
        raise BadRequest("alert engine unavailable")
    return await engine.run_once()


@router.get("/triggers/{trigger_id}", response_model=Trigger)
async def get_trigger(trigger_id: str) -> Any:
    return await store.get_trigger(trigger_id)


@router.put("/triggers/{trigger_id}", response_model=Trigger)
async def update_trigger(
    request: Request,
    trigger_id: str,
    body: TriggerPatch,
    registry: ClusterRegistry = Depends(get_registry),
) -> Any:
    payload = body.model_dump(exclude_none=True)
    if payload.get("component") and payload.get("metric"):
        _validate(payload["component"], payload["metric"], registry, payload.get("clusterId"))
    trigger = await store.update_trigger(trigger_id, payload)
    await audit(request, "alert.trigger.update", f"alerts/triggers/{trigger_id}", payload)
    return trigger


@router.delete("/triggers/{trigger_id}", status_code=204)
async def delete_trigger(request: Request, trigger_id: str) -> None:
    await store.delete_trigger(trigger_id)
    await audit(request, "alert.trigger.delete", f"alerts/triggers/{trigger_id}", {})


@router.post("/triggers/{trigger_id}/enable", response_model=Trigger)
async def enable_trigger(request: Request, trigger_id: str) -> Any:
    trigger = await store.set_trigger_enabled(trigger_id, True)
    await audit(request, "alert.trigger.enable", f"alerts/triggers/{trigger_id}", {})
    return trigger


@router.post("/triggers/{trigger_id}/disable", response_model=Trigger)
async def disable_trigger(request: Request, trigger_id: str) -> Any:
    trigger = await store.set_trigger_enabled(trigger_id, False)
    await audit(request, "alert.trigger.disable", f"alerts/triggers/{trigger_id}", {})
    return trigger


# ----------------------------------------------------------------------- actions


@router.get("/actions", response_model=list[Action])
async def list_actions() -> Any:
    return await store.list_actions()


@router.post("/actions", response_model=Action, status_code=201)
async def create_action(request: Request, body: ActionWrite) -> Any:
    action = await store.create_action(body.model_dump())
    await audit(
        request,
        "alert.action.create",
        f"alerts/actions/{action['id']}",
        {"type": body.type, "name": body.name},
    )
    return action


@router.get("/actions/{action_id}", response_model=Action)
async def get_action(action_id: str) -> Any:
    return await store.get_action(action_id)


@router.put("/actions/{action_id}", response_model=Action)
async def update_action(request: Request, action_id: str, body: ActionPatch) -> Any:
    action = await store.update_action(action_id, body.model_dump(exclude_none=True))
    await audit(request, "alert.action.update", f"alerts/actions/{action_id}", {})
    return action


@router.delete("/actions/{action_id}", status_code=204)
async def delete_action(request: Request, action_id: str) -> None:
    await store.delete_action(action_id)
    await audit(request, "alert.action.delete", f"alerts/actions/{action_id}", {})


@router.post("/actions/{action_id}/test", response_model=TestActionResult)
async def test_action(request: Request, action_id: str) -> Any:
    action = await store.get_action(action_id)
    settings = getattr(request.app.state, "settings", None)
    sample = {
        "id": "test",
        "triggerId": "test",
        "triggerName": "k-shui test notification",
        "component": "cluster",
        "metric": "underReplicatedPartitions",
        "condition": "gt",
        "target": "test-target",
        "clusterId": None,
        "severity": "info",
        "status": "firing",
        "value": 1,
        "threshold": 0,
        "firedAt": time.time(),
    }
    result = await notifiers.send(action, sample, settings)
    await audit(request, "alert.action.test", f"alerts/actions/{action_id}", {"status": result.get("status")})
    return result


# ----------------------------------------------------------------------- history


@router.get("/history", response_model=HistoryPage)
async def history(
    status: str | None = Query(None, pattern="^(firing|resolved)$"),
    component: str | None = Query(None),
    clusterId: str | None = Query(None),
    triggerId: str | None = Query(None),
    since: float | None = Query(None),
    page: int = Query(1, ge=1),
    perPage: int = Query(50, ge=1, le=500),
) -> Any:
    return await store.list_history(
        status=status,
        component=component,
        cluster_id=clusterId,
        trigger_id=triggerId,
        since=since,
        page=page,
        per_page=perPage,
    )


@router.post("/history/{history_id}/ack", response_model=HistoryEntry)
async def ack(request: Request, history_id: str) -> Any:
    user = getattr(getattr(request.state, "principal", None), "username", None)
    entry = await store.ack_history(history_id, user)
    await audit(request, "alert.history.ack", f"alerts/history/{history_id}", {})
    return entry


def _validate(component: str, metric: str, registry: ClusterRegistry, cluster_id: str | None) -> None:
    if component not in metrics_catalog.CATALOG:
        raise BadRequest(f"unknown alert component '{component}'")
    if metrics_catalog.find(component, metric) is None:
        known = [m["name"] for m in metrics_catalog.CATALOG[component]]
        raise BadRequest(f"unknown metric '{metric}' for component '{component}'; known: {known}")
    if cluster_id and registry.get(cluster_id) is None:
        raise BadRequest(f"unknown cluster '{cluster_id}'")
