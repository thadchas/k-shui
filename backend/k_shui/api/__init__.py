"""API router registry.

Every feature area lives in ``k_shui.api.routers.<name>`` and exposes a module-level
``router: fastapi.APIRouter``. Modules listed here that do not exist yet are skipped so
that feature areas can be developed independently. All routers are mounted under ``/api/v1``.
"""

from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter

log = logging.getLogger(__name__)

ROUTER_MODULES: list[str] = [
    "system",
    "auth",
    "audit",
    "events",
    "clusters",
    "partitions",
    "brokers",
    "topics",
    "messages",
    "consumer_groups",
    "acls",
    "quotas",
    "kraft",
    "scram",
    "cluster_configs",
    "replication",
    "schemas",
    "connect",
    "ksql",
    "flink",
    "metrics",
    "lineage",
    "alerts",
]


def build_api_router() -> APIRouter:
    api = APIRouter(prefix="/api/v1")
    for name in ROUTER_MODULES:
        try:
            module = importlib.import_module(f"k_shui.api.routers.{name}")
        except ModuleNotFoundError as exc:  # module itself missing → skip quietly
            if exc.name and exc.name.endswith(f"routers.{name}"):
                log.debug("router %s not present, skipping", name)
                continue
            raise
        router = getattr(module, "router", None)
        if router is None:
            log.warning("router module %s has no `router`", name)
            continue
        api.include_router(router)
    return api
