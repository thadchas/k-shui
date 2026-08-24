"""Alert evaluation engine.

An APScheduler ``AsyncIOScheduler`` job runs every ``settings.alerts.evaluationIntervalSeconds``:

1. load every enabled trigger,
2. resolve its targets and measure the metric (see :mod:`.evaluators`),
3. apply the ``bufferSeconds`` state machine — the condition must hold *continuously*
   for that long before the alert fires,
4. on fire: write an ``AlertHistory`` row, run the trigger's actions and publish
   ``alert.fired``; on recovery: close the row and publish ``alert.resolved``,
5. keep the ``kshui_alerts_firing{severity}`` gauge in sync.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from k_shui.config import Settings
from k_shui.core.registry import ClusterContext, ClusterRegistry
from k_shui.integrations.alerts import evaluators, notifiers, store
from k_shui.integrations.alerts.evaluators import Measurement

try:  # pragma: no cover
    import structlog

    log = structlog.get_logger(__name__)
except Exception:  # pragma: no cover
    import logging

    log = logging.getLogger(__name__)  # type: ignore[assignment]

CONDITIONS = {
    "gt": lambda value, threshold: value > threshold,
    "gte": lambda value, threshold: value >= threshold,
    "lt": lambda value, threshold: value < threshold,
    "lte": lambda value, threshold: value <= threshold,
    "eq": lambda value, threshold: value == threshold,
    "ne": lambda value, threshold: value != threshold,
}

_GAUGE: Any = None


def _gauge() -> Any:
    """Lazily create the ``kshui_alerts_firing`` gauge (idempotent across reloads)."""
    global _GAUGE
    if _GAUGE is not None:
        return _GAUGE
    try:
        from prometheus_client import REGISTRY, Gauge

        existing = getattr(REGISTRY, "_names_to_collectors", {}).get("kshui_alerts_firing")
        _GAUGE = existing or Gauge(
            "kshui_alerts_firing", "Number of currently firing k-shui alerts", ["severity"]
        )
    except Exception:  # pragma: no cover
        _GAUGE = None
    return _GAUGE


def compare(value: float, condition: str, threshold: float) -> bool:
    fn = CONDITIONS.get(condition)
    return bool(fn(value, threshold)) if fn else False


@dataclass(slots=True)
class TargetState:
    """Per (trigger, target) buffer state."""

    breaching_since: float | None = None
    firing_history_id: str | None = None
    last_value: float | None = None
    last_seen: float = field(default_factory=time.time)


class AlertEngine:
    """Owns the evaluation loop, the per-target buffer state and the notification fan-out."""

    def __init__(
        self,
        settings: Settings,
        registry: ClusterRegistry,
        *,
        evaluate_fn: Any = None,
        notify_fn: Any = None,
    ) -> None:
        self.settings = settings
        self.registry = registry
        self.state: dict[str, TargetState] = {}
        self._task: asyncio.Task[None] | None = None
        self._running = False
        self._lock = asyncio.Lock()
        self._evaluate = evaluate_fn or evaluators.evaluate
        self._notify = notify_fn or notifiers.send
        self.last_run: float | None = None
        self.last_error: str | None = None
        self.runs = 0

    # ------------------------------------------------------------------ lifecycle

    @property
    def interval(self) -> int:
        return max(int(getattr(self.settings.alerts, "evaluationIntervalSeconds", 30) or 30), 5)

    @property
    def running(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="kshui-alerts")
        log.info("alerts.engine_started", intervalSeconds=self.interval)

    async def _loop(self) -> None:
        """Evaluate immediately, then every ``interval`` seconds until stopped."""
        while self._running:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never let one bad pass kill the loop
                self.last_error = str(exc)
                log.warning("alerts.run_failed", error=str(exc))
            await asyncio.sleep(self.interval)

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, asyncio.TimeoutError, Exception):
                await asyncio.wait_for(task, timeout=5)
        log.info("alerts.engine_stopped")

    # ----------------------------------------------------------------- evaluation

    async def run_once(self) -> dict[str, Any]:
        """One full evaluation pass over every enabled trigger."""
        async with self._lock:
            started = time.time()
            fired = resolved = evaluated = 0
            try:
                triggers = await store.list_triggers(enabled=True)
            except Exception as exc:
                self.last_error = str(exc)
                log.warning("alerts.load_failed", error=str(exc))
                return {"evaluated": 0, "fired": 0, "resolved": 0, "error": str(exc)}
            for trigger in triggers:
                try:
                    stats = await self.evaluate_trigger(trigger)
                except Exception as exc:
                    log.warning("alerts.trigger_failed", trigger=trigger.get("id"), error=str(exc))
                    continue
                evaluated += stats["evaluated"]
                fired += stats["fired"]
                resolved += stats["resolved"]
            await self._sync_gauge()
            self.last_run = started
            self.last_error = None
            self.runs += 1
            return {
                "evaluated": evaluated,
                "fired": fired,
                "resolved": resolved,
                "durationMs": int((time.time() - started) * 1000),
            }

    def _contexts(self, trigger: dict[str, Any]) -> list[ClusterContext]:
        cluster_id = trigger.get("clusterId")
        if cluster_id:
            ctx = self.registry.get(cluster_id)
            return [ctx] if ctx is not None else []
        return self.registry.all()

    async def evaluate_trigger(self, trigger: dict[str, Any]) -> dict[str, int]:
        fired = resolved = evaluated = 0
        seen_keys: set[str] = set()
        for ctx in self._contexts(trigger):
            measurements = await self._evaluate(
                ctx, trigger["component"], trigger["metric"], trigger.get("target") or {}
            )
            for measurement in measurements:
                evaluated += 1
                key = f"{trigger['id']}|{ctx.id}|{measurement.target}"
                seen_keys.add(key)
                outcome = await self._apply(trigger, ctx, measurement, key)
                fired += 1 if outcome == "fired" else 0
                resolved += 1 if outcome == "resolved" else 0
        # Targets that disappeared entirely stop breaching.
        prefix = f"{trigger['id']}|"
        for key in [k for k in self.state if k.startswith(prefix) and k not in seen_keys]:
            state = self.state[key]
            if state.firing_history_id:
                await self._resolve(trigger, key, state, None)
                resolved += 1
            else:
                self.state.pop(key, None)
        return {"evaluated": evaluated, "fired": fired, "resolved": resolved}

    async def _apply(
        self, trigger: dict[str, Any], ctx: ClusterContext, measurement: Measurement, key: str
    ) -> str | None:
        state = self.state.setdefault(key, TargetState())
        state.last_seen = time.time()
        if measurement.value is None:
            return None  # no data: hold the current state rather than flapping
        state.last_value = measurement.value
        threshold = float(trigger.get("value", 0) or 0)
        breaching = compare(measurement.value, str(trigger.get("condition", "gt")), threshold)
        buffer_seconds = float(trigger.get("bufferSeconds", 0) or 0)
        now = time.time()

        if breaching:
            if state.breaching_since is None:
                state.breaching_since = now
            if state.firing_history_id is None and now - state.breaching_since >= buffer_seconds:
                await self._fire(trigger, ctx, measurement, state)
                return "fired"
            return None

        state.breaching_since = None
        if state.firing_history_id is not None:
            await self._resolve(trigger, key, state, measurement)
            return "resolved"
        return None

    async def _fire(
        self, trigger: dict[str, Any], ctx: ClusterContext, measurement: Measurement, state: TargetState
    ) -> None:
        row = await store.create_history(
            {
                "triggerId": trigger["id"],
                "triggerName": trigger.get("name", ""),
                "component": trigger["component"],
                "target": measurement.target,
                "clusterId": ctx.id,
                "severity": trigger.get("severity", "warning"),
                "status": "firing",
                "value": measurement.value,
                "threshold": float(trigger.get("value", 0) or 0),
                "notifications": [],
            }
        )
        state.firing_history_id = str(row.get("id"))
        payload = self._payload(trigger, row, measurement, "firing")
        notifications = await self._dispatch(trigger, payload)
        if notifications:
            with contextlib.suppress(Exception):
                await store.update_history(state.firing_history_id, {"notifications": notifications})
        await self._publish("alert.fired", ctx.id, payload)
        log.info(
            "alert.fired", trigger=trigger.get("name"), target=measurement.target, value=measurement.value
        )

    async def _resolve(
        self,
        trigger: dict[str, Any],
        key: str,
        state: TargetState,
        measurement: Measurement | None,
    ) -> None:
        history_id = state.firing_history_id
        state.firing_history_id = None
        state.breaching_since = None
        row: dict[str, Any] = {"id": history_id}
        if history_id:
            with contextlib.suppress(Exception):
                row = await store.update_history(
                    history_id,
                    {
                        "status": "resolved",
                        "resolvedAt": datetime.now(UTC),
                        "value": measurement.value if measurement else state.last_value,
                    },
                )
        cluster_id = key.split("|")[1] if "|" in key else None
        payload = self._payload(trigger, row, measurement, "resolved")
        await self._dispatch(trigger, payload)
        await self._publish("alert.resolved", cluster_id, payload)
        self.state.pop(key, None)
        log.info("alert.resolved", trigger=trigger.get("name"), target=payload.get("target"))

    def _payload(
        self,
        trigger: dict[str, Any],
        row: dict[str, Any],
        measurement: Measurement | None,
        status: str,
    ) -> dict[str, Any]:
        return {
            "id": row.get("id"),
            "triggerId": trigger["id"],
            "triggerName": trigger.get("name", ""),
            "component": trigger.get("component"),
            "metric": trigger.get("metric"),
            "condition": trigger.get("condition"),
            "target": measurement.target if measurement else row.get("target"),
            "clusterId": row.get("clusterId"),
            "severity": trigger.get("severity", "warning"),
            "status": status,
            "value": measurement.value if measurement else row.get("value"),
            "threshold": float(trigger.get("value", 0) or 0),
            "firedAt": row.get("firedAt"),
            "resolvedAt": row.get("resolvedAt"),
            "labels": measurement.labels if measurement else {},
        }

    async def _dispatch(self, trigger: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
        action_ids = [str(a) for a in (trigger.get("actionIds") or [])]
        if not action_ids:
            return []
        try:
            actions = await store.actions_for(action_ids)
        except Exception:
            return []
        results = await asyncio.gather(
            *(self._notify(action, payload, self.settings) for action in actions),
            return_exceptions=True,
        )
        out: list[dict[str, Any]] = []
        for action, result in zip(actions, results, strict=False):
            if isinstance(result, BaseException):
                out.append({"actionId": action.get("id"), "status": "failed", "error": str(result)})
            else:
                out.append(dict(result))
        return out

    async def _publish(self, event_type: str, cluster_id: str | None, payload: dict[str, Any]) -> None:
        from k_shui.integrations.audit import publish

        await publish(event_type, cluster_id, payload)

    async def _sync_gauge(self) -> None:
        gauge = _gauge()
        if gauge is None:
            return
        counts = {"critical": 0, "warning": 0, "info": 0}
        try:
            firing = await store.list_history(status="firing", per_page=1000)
        except Exception:
            return
        for row in firing["items"]:
            severity = str(row.get("severity", "warning"))
            counts[severity] = counts.get(severity, 0) + 1
        with contextlib.suppress(Exception):
            for severity, count in counts.items():
                gauge.labels(severity=severity).set(count)

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "intervalSeconds": self.interval,
            "lastRun": self.last_run,
            "lastError": self.last_error,
            "runs": self.runs,
            "trackedTargets": len(self.state),
        }


# --------------------------------------------------------------- app integration

_engine: AlertEngine | None = None


def get_engine() -> AlertEngine | None:
    return _engine


async def start_alert_engine(app: Any) -> AlertEngine | None:
    """Start (or reuse) the engine bound to ``app.state.settings`` / ``app.state.registry``."""
    global _engine
    settings = getattr(app.state, "settings", None)
    registry = getattr(app.state, "registry", None)
    if settings is None or registry is None:
        log.warning("alerts.engine_not_started", reason="settings/registry missing")
        return None
    if _engine is None:
        _engine = AlertEngine(settings, registry)
    app.state.alert_engine = _engine
    await _engine.start()
    return _engine


async def stop_alert_engine(app: Any = None) -> None:
    global _engine
    if _engine is not None:
        await _engine.stop()
    _engine = None
    if app is not None and hasattr(app.state, "alert_engine"):
        app.state.alert_engine = None


async def ensure_started(app: Any) -> AlertEngine | None:
    """Lazy start used by the alerts API, in case the app factory never called setup()."""
    engine = getattr(app.state, "alert_engine", None) or _engine
    if engine is not None and engine.running:
        app.state.alert_engine = engine
        return engine
    return await start_alert_engine(app)
