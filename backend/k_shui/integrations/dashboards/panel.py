"""Panel/dashboard building blocks shared by the built-in dashboard modules."""

from __future__ import annotations

from typing import Any

# `topic=""` isolates the broker-wide aggregate series from the per-topic ones.
BROKER_AGG = '{topic="",strimzi_io_broker_role!="false"}'
JVM_USED = (
    'sum(jvm_memory_used_bytes{area="heap"}) by (instance) '
    'or sum(jvm_memory_bytes_used{area="heap"}) by (instance)'
)


def panel(
    panel_id: str,
    title: str,
    type_: str,
    unit: str,
    queries: list[tuple[str, str]],
    **extra: Any,
) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "id": panel_id,
        "title": title,
        "type": type_,
        "unit": unit,
        "queries": [{"expr": expr, "legend": legend} for expr, legend in queries],
    }
    spec.update(extra)
    return spec
