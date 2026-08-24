"""Alert notification channels: email, Slack, PagerDuty, generic webhook and MS Teams.

Every notifier takes the action config plus the alert payload and returns
``{status: 'sent'|'failed', error?}``. Failures are reported, never raised, so one broken
channel cannot stop the others.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from k_shui.config import Settings

try:  # pragma: no cover
    import structlog

    log = structlog.get_logger(__name__)
except Exception:  # pragma: no cover
    import logging

    log = logging.getLogger(__name__)  # type: ignore[assignment]

SEVERITY_COLORS = {"critical": "#dc2626", "warning": "#f59e0b", "info": "#3b82f6"}
PAGERDUTY_SEVERITY = {"critical": "critical", "warning": "warning", "info": "info"}
DEFAULT_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)


def summary_line(alert: dict[str, Any]) -> str:
    status = str(alert.get("status", "firing")).upper()
    return (
        f"[{status}] {alert.get('severity', 'warning')} — {alert.get('triggerName')} "
        f"({alert.get('component')}/{alert.get('target')}) "
        f"value={alert.get('value')} threshold={alert.get('threshold')}"
    )


def dedup_key(alert: dict[str, Any]) -> str:
    return f"kshui-{alert.get('triggerId')}-{alert.get('clusterId')}-{alert.get('target')}"


def render_template(template: str, alert: dict[str, Any]) -> str:
    """Render a Jinja2 template with the alert payload (falls back to ``str.format``)."""
    try:
        from jinja2 import Template

        return Template(template).render(alert=alert, **alert)
    except Exception:
        try:
            return template.format(**alert)
        except Exception:
            return template


async def notify_slack(config: dict[str, Any], alert: dict[str, Any]) -> dict[str, Any]:
    url = config.get("webhookUrl") or config.get("url")
    if not url:
        return {"status": "failed", "error": "slack action requires webhookUrl"}
    color = SEVERITY_COLORS.get(str(alert.get("severity")), "#6b7280")
    emoji = "🔥" if alert.get("status") == "firing" else "✅"
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{emoji} {alert.get('triggerName', 'alert')}"},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Status*\n{alert.get('status')}"},
                {"type": "mrkdwn", "text": f"*Severity*\n{alert.get('severity')}"},
                {"type": "mrkdwn", "text": f"*Cluster*\n{alert.get('clusterId') or '—'}"},
                {"type": "mrkdwn", "text": f"*Target*\n{alert.get('target') or '—'}"},
                {"type": "mrkdwn", "text": f"*Metric*\n{alert.get('metric') or '—'}"},
                {
                    "type": "mrkdwn",
                    "text": f"*Value*\n{alert.get('value')} (threshold {alert.get('threshold')})",
                },
            ],
        },
    ]
    payload: dict[str, Any] = {
        "text": summary_line(alert),
        "blocks": blocks,
        "attachments": [{"color": color, "blocks": []}],
    }
    if config.get("channel"):
        payload["channel"] = config["channel"]
    return await _post(url, json=payload)


async def notify_teams(config: dict[str, Any], alert: dict[str, Any]) -> dict[str, Any]:
    url = config.get("webhookUrl") or config.get("url")
    if not url:
        return {"status": "failed", "error": "teams action requires webhookUrl"}
    payload = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "themeColor": SEVERITY_COLORS.get(str(alert.get("severity")), "6b7280").lstrip("#"),
        "summary": summary_line(alert),
        "title": f"{alert.get('triggerName')} ({alert.get('status')})",
        "sections": [
            {
                "facts": [
                    {"name": "Severity", "value": str(alert.get("severity"))},
                    {"name": "Cluster", "value": str(alert.get("clusterId") or "—")},
                    {"name": "Component", "value": str(alert.get("component"))},
                    {"name": "Target", "value": str(alert.get("target") or "—")},
                    {"name": "Metric", "value": str(alert.get("metric") or "—")},
                    {"name": "Value", "value": str(alert.get("value"))},
                    {"name": "Threshold", "value": str(alert.get("threshold"))},
                ],
                "markdown": True,
            }
        ],
    }
    return await _post(url, json=payload)


async def notify_pagerduty(config: dict[str, Any], alert: dict[str, Any]) -> dict[str, Any]:
    routing_key = config.get("routingKey") or config.get("integrationKey")
    if not routing_key:
        return {"status": "failed", "error": "pagerduty action requires routingKey"}
    url = config.get("url") or "https://events.pagerduty.com/v2/enqueue"
    action = "resolve" if alert.get("status") == "resolved" else "trigger"
    payload: dict[str, Any] = {
        "routing_key": routing_key,
        "event_action": action,
        "dedup_key": dedup_key(alert),
    }
    if action == "trigger":
        payload["payload"] = {
            "summary": summary_line(alert),
            "severity": PAGERDUTY_SEVERITY.get(str(alert.get("severity")), "warning"),
            "source": f"k-shui/{alert.get('clusterId') or 'global'}",
            "component": str(alert.get("component")),
            "group": str(alert.get("clusterId") or ""),
            "class": str(alert.get("metric") or ""),
            "custom_details": {
                k: alert.get(k) for k in ("value", "threshold", "condition", "target", "triggerId")
            },
        }
    return await _post(url, json=payload)


async def notify_webhook(config: dict[str, Any], alert: dict[str, Any]) -> dict[str, Any]:
    url = config.get("url")
    if not url:
        return {"status": "failed", "error": "webhook action requires url"}
    method = str(config.get("method", "POST")).upper()
    headers = {"Content-Type": "application/json", **(config.get("headers") or {})}
    template = config.get("template")
    if template:
        body = render_template(template, alert)
        try:
            return await _post(url, method=method, headers=headers, json=json.loads(body))
        except json.JSONDecodeError:
            headers.setdefault("Content-Type", "text/plain")
            return await _post(url, method=method, headers=headers, content=body.encode())
    return await _post(url, method=method, headers=headers, json=alert)


async def notify_email(
    config: dict[str, Any], alert: dict[str, Any], settings: Settings | None = None
) -> dict[str, Any]:
    smtp: dict[str, Any] = {}
    if settings is not None and getattr(settings.alerts, "smtp", None):
        smtp = dict(settings.alerts.smtp or {})
    smtp.update({k: v for k, v in (config.get("smtp") or {}).items()})
    host = smtp.get("host") or config.get("host")
    if not host:
        return {"status": "failed", "error": "email action requires alerts.smtp.host"}
    recipients = config.get("to") or config.get("recipients") or []
    if isinstance(recipients, str):
        recipients = [r.strip() for r in recipients.split(",") if r.strip()]
    if not recipients:
        return {"status": "failed", "error": "email action requires at least one recipient"}
    sender = config.get("from") or smtp.get("from") or "k-shui@localhost"
    subject = config.get("subject") or summary_line(alert)

    try:
        from email.message import EmailMessage

        import aiosmtplib

        message = EmailMessage()
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject
        message.set_content(_email_body(alert))
        message.add_alternative(_email_html(alert), subtype="html")
        await aiosmtplib.send(
            message,
            hostname=host,
            port=int(smtp.get("port", config.get("port", 587))),
            username=smtp.get("username") or config.get("username"),
            password=smtp.get("password") or config.get("password"),
            start_tls=bool(smtp.get("tls", smtp.get("startTls", True))),
            timeout=15,
        )
        return {"status": "sent", "recipients": recipients}
    except Exception as exc:
        return {"status": "failed", "error": str(exc)}


def _email_body(alert: dict[str, Any]) -> str:
    return "\n".join(
        f"{key}: {alert.get(key)}"
        for key in (
            "triggerName",
            "status",
            "severity",
            "clusterId",
            "component",
            "target",
            "metric",
            "condition",
            "threshold",
            "value",
            "firedAt",
            "resolvedAt",
        )
    )


def _email_html(alert: dict[str, Any]) -> str:
    color = SEVERITY_COLORS.get(str(alert.get("severity")), "#6b7280")
    rows = "".join(
        f"<tr><td style='padding:4px 12px;color:#666'>{key}</td>"
        f"<td style='padding:4px 12px'><b>{alert.get(key)}</b></td></tr>"
        for key in (
            "status",
            "severity",
            "clusterId",
            "component",
            "target",
            "metric",
            "condition",
            "threshold",
            "value",
        )
    )
    return (
        f"<div style='font-family:system-ui,sans-serif'>"
        f"<h2 style='color:{color};margin-bottom:4px'>{alert.get('triggerName')}</h2>"
        f"<table style='border-collapse:collapse'>{rows}</table></div>"
    )


async def _post(url: str, method: str = "POST", **kwargs: Any) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            resp = await client.request(method, url, **kwargs)
        if resp.is_success:
            return {"status": "sent", "httpStatus": resp.status_code}
        return {
            "status": "failed",
            "httpStatus": resp.status_code,
            "error": (resp.text or "")[:300],
        }
    except Exception as exc:
        return {"status": "failed", "error": str(exc)}


NOTIFIERS = {
    "slack": notify_slack,
    "teams": notify_teams,
    "pagerduty": notify_pagerduty,
    "webhook": notify_webhook,
}


async def send(
    action: dict[str, Any], alert: dict[str, Any], settings: Settings | None = None
) -> dict[str, Any]:
    """Dispatch one notification; the result is stored on the alert history row."""
    action_type = str(action.get("type", "")).lower()
    config = action.get("config") or {}
    result: dict[str, Any]
    if action_type == "email":
        result = await notify_email(config, alert, settings)
    else:
        notifier = NOTIFIERS.get(action_type)
        if notifier is None:
            result = {"status": "failed", "error": f"unknown action type '{action_type}'"}
        else:
            result = await notifier(config, alert)
    result["actionId"] = action.get("id")
    result["actionType"] = action_type
    if result.get("status") == "failed":
        log.warning("alert.notify_failed", action=action.get("name"), error=result.get("error"))
    return result
