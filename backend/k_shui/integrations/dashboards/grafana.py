"""Grafana dashboard JSON → k-shui dashboard conversion.

Handles both layouts Grafana emits: flat panel lists with ``type: "row"`` separators
(schema v16+) and rows carrying nested ``panels``.
"""

from __future__ import annotations

import re
from typing import Any

PANEL_TYPES = {
    "timeseries": "timeseries",
    "graph": "timeseries",
    "time_series": "timeseries",
    "stat": "stat",
    "singlestat": "stat",
    "gauge": "gauge",
    "table": "table",
    "table-old": "table",
    "barchart": "bar",
    "bargauge": "bar",
    "piechart": "bar",
    "heatmap": "heatmap",
    "histogram": "heatmap",
    "logs": "table",
    "text": "text",
}

_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(value: str, fallback: str = "dashboard") -> str:
    slug = _SLUG.sub("-", (value or "").lower()).strip("-")
    return slug or fallback


def _unit(panel: dict[str, Any]) -> str:
    defaults = (panel.get("fieldConfig") or {}).get("defaults") or {}
    return defaults.get("unit") or panel.get("format") or "short"


def _thresholds(panel: dict[str, Any]) -> list[dict[str, Any]]:
    defaults = (panel.get("fieldConfig") or {}).get("defaults") or {}
    steps = (defaults.get("thresholds") or {}).get("steps") or []
    out = [
        {"value": s.get("value"), "color": s.get("color")}
        for s in steps
        if isinstance(s, dict) and s.get("value") is not None
    ]
    return out


def _queries(panel: dict[str, Any]) -> list[dict[str, Any]]:
    queries = []
    for index, target in enumerate(panel.get("targets") or []):
        if not isinstance(target, dict):
            continue
        expr = target.get("expr") or target.get("query")
        if not expr:
            continue
        queries.append(
            {
                "expr": expr,
                "legend": target.get("legendFormat") or target.get("legend") or "",
                "refId": target.get("refId") or chr(ord("A") + index),
            }
        )
    return queries


def convert_panel(panel: dict[str, Any], index: int) -> dict[str, Any] | None:
    grafana_type = str(panel.get("type") or "timeseries")
    if grafana_type == "row":
        return None
    queries = _queries(panel)
    if not queries and grafana_type != "text":
        return None
    return {
        "id": str(panel.get("id") or f"panel-{index}"),
        "title": panel.get("title") or f"Panel {index + 1}",
        "type": PANEL_TYPES.get(grafana_type, "timeseries"),
        "unit": _unit(panel),
        "queries": queries,
        "thresholds": _thresholds(panel),
        "description": panel.get("description") or "",
    }


def convert(payload: dict[str, Any], dashboard_id: str | None = None) -> dict[str, Any]:
    """Convert a Grafana dashboard JSON export into the k-shui dashboard shape."""
    board = payload.get("dashboard") if isinstance(payload.get("dashboard"), dict) else payload
    title = board.get("title") or "Imported dashboard"
    rows: list[dict[str, Any]] = []
    current: dict[str, Any] = {"title": "", "panels": []}
    index = 0

    def flush() -> None:
        if current["panels"]:
            rows.append({"title": current["title"], "panels": list(current["panels"])})
        current["panels"] = []

    for panel in board.get("panels") or []:
        if not isinstance(panel, dict):
            continue
        if panel.get("type") == "row":
            flush()
            current["title"] = panel.get("title") or ""
            for nested in panel.get("panels") or []:
                converted = convert_panel(nested, index)
                index += 1
                if converted:
                    current["panels"].append(converted)
            flush()
            current["title"] = ""
            continue
        converted = convert_panel(panel, index)
        index += 1
        if converted:
            current["panels"].append(converted)
    flush()

    # Legacy schema: top-level `rows: [{title, panels: []}]`
    for row in board.get("rows") or []:
        if not isinstance(row, dict):
            continue
        panels = []
        for panel in row.get("panels") or []:
            converted = convert_panel(panel, index)
            index += 1
            if converted:
                panels.append(converted)
        if panels:
            rows.append({"title": row.get("title") or "", "panels": panels})

    variables = [
        {
            "name": v.get("name"),
            "query": v.get("query")
            if isinstance(v.get("query"), str)
            else (v.get("query") or {}).get("query", ""),
            "label": v.get("label") or v.get("name"),
            "multi": bool(v.get("multi")),
        }
        for v in ((board.get("templating") or {}).get("list") or [])
        if isinstance(v, dict) and v.get("name")
    ]

    return {
        "id": dashboard_id or slugify(str(board.get("uid") or title)),
        "title": title,
        "description": board.get("description") or "Imported from Grafana",
        "tags": [str(t) for t in (board.get("tags") or [])],
        "builtin": False,
        "variables": variables,
        "rows": rows,
    }
