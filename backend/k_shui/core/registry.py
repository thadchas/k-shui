"""ClusterRegistry: one place that owns per-cluster clients (Kafka admin, HTTP clients for
integrations). Feature modules get a ``ClusterContext`` via ``get_cluster`` dependency.

Contract for all agents:

    from k_shui.core.registry import ClusterContext, get_cluster
    @router.get("/clusters/{cluster_id}/foo")
    async def foo(ctx: ClusterContext = Depends(get_cluster)): ...

``ClusterContext`` lazily constructs and caches clients; attributes are added by feature
modules through the ``client(key, factory)`` helper so this file never needs editing.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import Depends, HTTPException, Request

from k_shui.config import ClusterConfig, Settings

T = TypeVar("T")


class ClusterContext:
    def __init__(self, config: ClusterConfig, settings: Settings) -> None:
        self.config = config
        self.settings = settings
        self._clients: dict[str, Any] = {}

    @property
    def id(self) -> str:
        return self.config.id

    def client(self, key: str, factory: Callable[[ClusterContext], T]) -> T:
        if key not in self._clients:
            self._clients[key] = factory(self)
        return self._clients[key]

    async def aclose(self) -> None:
        for c in self._clients.values():
            close = getattr(c, "aclose", None) or getattr(c, "close", None)
            if close is None:
                continue
            res = close()
            if hasattr(res, "__await__"):
                await res
        self._clients.clear()


class ClusterRegistry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._contexts: dict[str, ClusterContext] = {
            c.id: ClusterContext(c, settings) for c in settings.clusters
        }

    def ids(self) -> list[str]:
        return list(self._contexts)

    def all(self) -> list[ClusterContext]:
        return list(self._contexts.values())

    def get(self, cluster_id: str) -> ClusterContext | None:
        return self._contexts.get(cluster_id)

    async def aclose(self) -> None:
        for ctx in self._contexts.values():
            await ctx.aclose()


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_registry(request: Request) -> ClusterRegistry:
    return request.app.state.registry


def get_cluster(cluster_id: str, registry: ClusterRegistry = Depends(get_registry)) -> ClusterContext:
    ctx = registry.get(cluster_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail=f"cluster '{cluster_id}' not found")
    return ctx
