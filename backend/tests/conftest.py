"""Shared fixtures: a fully wired app whose Kafka layer is replaced by in-memory fakes."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from k_shui.config import AuthConfig, ClusterConfig, DatabaseConfig, ServerConfig, Settings, TelemetryConfig
from k_shui.main import create_app
from tests.fakes import FakeKafkaAdmin, FakeMessageBrowser, FakeProducer

CLUSTER_ID = "test"


def build_settings(tmp_path: Any, **overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "server": ServerConfig(port=0),
        "auth": AuthConfig(type="none", jwtSecret="test-secret"),
        "database": DatabaseConfig(url=f"sqlite+aiosqlite:///{tmp_path}/k-shui-test.db"),
        "telemetry": TelemetryConfig(metrics=True, logLevel="WARNING"),
        "clusters": [
            ClusterConfig(
                id=CLUSTER_ID, name="Test cluster", bootstrapServers="fake:9092", pollIntervalSeconds=5
            )
        ],
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture(autouse=True)
def fake_kafka(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the ``ctx.client(...)`` factories so no real broker is ever contacted."""
    from k_shui.kafka.admin import KafkaAdmin
    from k_shui.kafka.consumer import MessageBrowser
    from k_shui.kafka.producer import MessageProducer

    monkeypatch.setattr(KafkaAdmin, "from_context", classmethod(lambda cls, ctx: FakeKafkaAdmin(ctx)))
    monkeypatch.setattr(MessageBrowser, "from_context", classmethod(lambda cls, ctx: FakeMessageBrowser(ctx)))
    monkeypatch.setattr(MessageProducer, "from_context", classmethod(lambda cls, ctx: FakeProducer(ctx)))


@pytest.fixture(autouse=True)
def no_alert_engine(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """The alert engine owns its own scheduler and tests; keep it out of core-router runs.

    Opt back in with ``@pytest.mark.alert_engine``.
    """
    if request.node.get_closest_marker("alert_engine"):
        return
    import k_shui.main as main_module

    async def _noop(app: Any) -> None:
        app.state.alert_engine = None

    monkeypatch.setattr(main_module, "_start_alert_engine", _noop)


@pytest.fixture
def settings(tmp_path: Any) -> Settings:
    return build_settings(tmp_path)


@pytest_asyncio.fixture
async def app(settings: Settings) -> AsyncIterator[Any]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        c.app = app  # type: ignore[attr-defined]
        yield c


@pytest.fixture
def admin(app: Any) -> FakeKafkaAdmin:
    """The fake admin bound to the test cluster context."""
    from k_shui.kafka.admin import KafkaAdmin

    return KafkaAdmin.get(app.state.registry.get(CLUSTER_ID))  # type: ignore[return-value]


@pytest_asyncio.fixture
async def basic_auth_client(tmp_path: Any) -> AsyncIterator[AsyncClient]:
    """App configured with basic auth: admin/editor/viewer users."""
    from k_shui.config import BasicAuthUser

    settings = build_settings(
        tmp_path,
        auth=AuthConfig(
            type="basic",
            jwtSecret="test-secret",
            users=[
                BasicAuthUser(username="root", password="rootpw", role="admin"),
                BasicAuthUser(username="ed", password="edpw", role="editor"),
                BasicAuthUser(username="vi", password="vipw", role="viewer"),
            ],
        ),
    )
    application = create_app(settings)
    transport = ASGITransport(app=application)
    async with (
        application.router.lifespan_context(application),
        AsyncClient(transport=transport, base_url="http://testserver") as c,
    ):
            c.app = application  # type: ignore[attr-defined]
            yield c
