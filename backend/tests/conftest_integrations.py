"""Fixtures for the integration tests (schema registry, Connect, ksqlDB, Flink, metrics,
lineage, alerts).

Builds a *minimal* FastAPI app that mounts only the integration routers, so these tests
never depend on ``k_shui.main`` or on a real Kafka broker. Imported explicitly by each
``test_<area>.py`` (``tests/conftest.py`` is owned by another module).
"""

from __future__ import annotations

import importlib
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from k_shui.config import (
    ClusterConfig,
    ConnectClusterConfig,
    FlinkConfig,
    KsqlConfig,
    LineageConfig,
    PrometheusConfig,
    SchemaRegistryConfig,
    Settings,
)
from k_shui.core.errors import install_error_handlers
from k_shui.core.registry import ClusterRegistry

CLUSTER = "itest"
SR_URL = "http://sr.test/apis/ccompat/v7"
CONNECT_URL = "http://connect.test"
CONNECT_NAME = "kc1"
KSQL_URL = "http://ksql.test"
KSQL_NAME = "ksql1"
FLINK_URL = "http://flink.test"
FLINK_NAME = "flink1"
PROM_URL = "http://prom.test"
MARQUEZ_URL = "http://marquez.test/api/v1"

INTEGRATION_ROUTERS = (
    "schemas",
    "connect",
    "replication",
    "ksql",
    "flink",
    "metrics",
    "lineage",
    "alerts",
)


def build_settings(**overrides: Any) -> Settings:
    cluster = ClusterConfig(
        id=CLUSTER,
        name="Integration test cluster",
        bootstrapServers="fake:9092",
        schemaRegistry=SchemaRegistryConfig(url=SR_URL, type="apicurio"),
        connect=[ConnectClusterConfig(name=CONNECT_NAME, url=CONNECT_URL)],
        ksqldb=[KsqlConfig(name=KSQL_NAME, url=KSQL_URL)],
        flink=[FlinkConfig(name=FLINK_NAME, url=FLINK_URL)],
        prometheus=PrometheusConfig(url=PROM_URL, labels={}),
        lineage=LineageConfig(type="marquez", url=MARQUEZ_URL),
    )
    data: dict[str, Any] = {"clusters": [cluster]}
    data.update(overrides)
    return Settings(**data)


def build_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or build_settings()
    app = FastAPI()
    install_error_handlers(app)
    app.state.settings = settings
    app.state.registry = ClusterRegistry(settings)
    app.state.alert_engine = None
    for name in INTEGRATION_ROUTERS:
        module = importlib.import_module(f"k_shui.api.routers.{name}")
        app.include_router(module.router, prefix="/api/v1")
    return app


@pytest.fixture
def integration_settings() -> Settings:
    return build_settings()


@pytest.fixture
def integration_app(integration_settings: Settings) -> FastAPI:
    return build_app(integration_settings)


@pytest_asyncio.fixture
async def api(integration_app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=integration_app)
    async with AsyncClient(transport=transport, base_url="http://itest") as client:
        yield client
    await integration_app.state.registry.aclose()


@pytest.fixture
def ctx(integration_app: FastAPI) -> Any:
    return integration_app.state.registry.get(CLUSTER)


def base(path: str = "") -> str:
    return f"/api/v1/clusters/{CLUSTER}{path}"
