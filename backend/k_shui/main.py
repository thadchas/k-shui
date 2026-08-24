"""FastAPI application factory: lifespan, middleware, health/metrics and SPA serving."""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from k_shui import __version__, metrics
from k_shui.api import build_api_router
from k_shui.config import Settings, load_settings
from k_shui.core.audit import AuditMiddleware
from k_shui.core.errors import install_error_handlers
from k_shui.core.events import get_bus
from k_shui.core.logging import configure_logging, get_logger
from k_shui.core.registry import ClusterRegistry
from k_shui.core.sampler import SamplerManager
from k_shui.db import session as db_session
from k_shui.middleware import RequestLoggingMiddleware, SecurityHeadersMiddleware

log = get_logger(__name__)

STATIC_DIR = Path(__file__).parent / "static"


def _base_path(settings: Settings) -> str:
    base = (settings.server.basePath or "/").rstrip("/")
    return base if base.startswith("/") or base == "" else "/" + base


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    app.state.started_at = time.time()
    app.state.bus = get_bus()
    app.state.registry = ClusterRegistry(settings)

    try:
        await db_session.init_db(settings)
        from k_shui.core.auth import sync_config_users

        await sync_config_users(settings)
    except Exception as exc:
        log.error("db.init_failed", error=str(exc))

    app.state.samplers = SamplerManager(app.state.registry)
    app.state.samplers.start()
    await _start_alert_engine(app)

    log.info(
        "app.started",
        version=__version__,
        clusters=[c.config.id for c in app.state.registry.all()],
        auth=settings.auth.type,
        config=settings.configPath,
    )
    try:
        yield
    finally:
        await _stop_alert_engine(app)
        with contextlib.suppress(Exception):
            await app.state.samplers.stop()
        with contextlib.suppress(Exception):
            await app.state.registry.aclose()
        with contextlib.suppress(Exception):
            await db_session.close_db()
        log.info("app.stopped")


async def _start_alert_engine(app: FastAPI) -> None:
    """Start the alert engine when the integrations agent has provided one."""
    try:
        from k_shui.integrations.alerts.engine import AlertEngine  # type: ignore[attr-defined]
    except (ImportError, AttributeError):
        app.state.alert_engine = None
        return
    try:
        engine = AlertEngine(app.state.settings, app.state.registry)
        await engine.start()
        app.state.alert_engine = engine
        log.info("alerts.engine_started")
    except Exception as exc:
        app.state.alert_engine = None
        log.warning("alerts.engine_failed", error=str(exc))


async def _stop_alert_engine(app: FastAPI) -> None:
    engine = getattr(app.state, "alert_engine", None)
    if engine is None:
        return
    app.state.alert_engine = None
    try:
        await asyncio.wait_for(engine.stop(), timeout=5.0)
    except TimeoutError:
        log.warning("alerts.engine_stop_timeout")
    except Exception as exc:
        log.warning("alerts.engine_stop_failed", error=str(exc))


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging(settings.telemetry.logFormat, settings.telemetry.logLevel)

    base = _base_path(settings)
    app = FastAPI(
        title="k-shui",
        version=__version__,
        description="Kafka Streaming Hub UI — open-source control center for Apache Kafka and its ecosystem.",
        lifespan=lifespan,
        root_path=base if base not in ("", "/") else "",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    app.state.settings = settings
    app.state.registry = ClusterRegistry(settings)
    app.state.samplers = None
    app.state.started_at = time.time()

    install_error_handlers(app)
    _install_middleware(app, settings)
    _install_ops_routes(app, settings)
    app.include_router(build_api_router())
    _install_spa(app, settings)
    _install_otel(app, settings)
    return app


def _install_middleware(app: FastAPI, settings: Settings) -> None:
    origins = list(settings.server.cors)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=bool(origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "content-disposition"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AuditMiddleware)
    app.add_middleware(RequestLoggingMiddleware)


def _install_ops_routes(app: FastAPI, settings: Settings) -> None:
    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, Any]:
        return {"status": "ok", "version": __version__}

    @app.get("/readyz", include_in_schema=False)
    async def readyz(request: Request) -> JSONResponse:
        manager: SamplerManager | None = getattr(request.app.state, "samplers", None)
        registry: ClusterRegistry = request.app.state.registry
        clusters: dict[str, Any] = {}
        online = 0
        for ctx in registry.all():
            sampler = manager.get(ctx.config.id) if manager else None
            sample = sampler.latest if sampler else None
            ok = sample is not None and sample.error is None
            if sample is None:  # not sampled yet — probe directly
                from k_shui.kafka.admin import KafkaAdmin

                try:
                    await KafkaAdmin.get(ctx).ping()
                    ok = True
                except Exception as exc:
                    clusters[ctx.config.id] = {"reachable": False, "error": str(exc)[:200]}
                    continue
            clusters[ctx.config.id] = {"reachable": ok}
            online += 1 if ok else 0
        degraded = online < len(clusters)
        body = {
            "status": "ok" if online else "degraded",
            "degraded": degraded,
            "clustersOnline": online,
            "clustersTotal": len(clusters),
            "clusters": clusters,
            "database": db_session.is_ready(),
        }
        return JSONResponse(body, status_code=200)

    if settings.telemetry.metrics:

        @app.get("/metrics", include_in_schema=False)
        async def prometheus_metrics(request: Request) -> Response:
            metrics.refresh_from_samplers(
                getattr(request.app.state, "samplers", None), getattr(request.app.state, "bus", None)
            )
            return Response(metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")


def _install_spa(app: FastAPI, settings: Settings) -> None:
    """Serve the built frontend from ``k_shui/static`` with history-API fallback."""
    index = STATIC_DIR / "index.html"
    if not index.exists():

        @app.get("/", include_in_schema=False)
        async def root_pointer() -> dict[str, Any]:
            return {
                "name": "k-shui",
                "version": __version__,
                "docs": "/docs",
                "api": "/api/v1",
                "health": "/healthz",
                "message": "no frontend bundle found in k_shui/static; API is available",
            }

        return

    from fastapi.staticfiles import StaticFiles

    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        # Stylesheets reference the web fonts at root-absolute URLs too, and those are
        # fetched by the CSS engine rather than resolved from index.html, so they need
        # the same prefixing. Serve rewritten copies ahead of the static mount.
        for name, body in _render_css(assets, _base_path(settings)).items():
            app.add_api_route(
                f"/assets/{name}",
                _css_route(body),
                methods=["GET"],
                include_in_schema=False,
            )
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    # The bundle is built with vite `base: "/"`, so index.html references its assets
    # at root-absolute paths. Behind an ingress that serves the UI under a sub-path
    # those URLs resolve outside the app and 404, so rewrite them once at startup and
    # publish the prefix for the frontend's basePath() helper to read.
    index_body = _render_index(index, _base_path(settings))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> Response:
        if full_path.startswith(("api/", "docs", "redoc", "openapi.json", "metrics", "healthz", "readyz")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return HTMLResponse(index_body)


_BASE_TAG_RE = re.compile(r'\b(src|href)="/(?!/)')
_BASE_CSS_RE = re.compile(r"url\(/(?!/)")


def _render_css(assets: Path, base: str) -> dict[str, str]:
    """Stylesheets whose root-absolute ``url(...)`` targets need the base prefix."""
    if not base:
        return {}
    out: dict[str, str] = {}
    for css in assets.glob("*.css"):
        body = css.read_text(encoding="utf-8")
        rewritten = _BASE_CSS_RE.sub(f"url({base}/", body)
        if rewritten != body:
            out[css.name] = rewritten
    return out


def _css_route(body: str):
    async def route() -> Response:
        return Response(body, media_type="text/css")

    return route


def _render_index(index: Path, base: str) -> str:
    """index.html with asset URLs prefixed by ``base`` and ``window.__KSHUI_BASE__`` set.

    ``base`` is "" when the UI is served from the root, in which case the document is
    returned untouched.
    """
    html = index.read_text(encoding="utf-8")
    if not base:
        return html
    html = _BASE_TAG_RE.sub(rf'\1="{base}/', html)
    inject = f'<script>window.__KSHUI_BASE__="{base}";</script>'
    if "</head>" in html:
        return html.replace("</head>", f"  {inject}\n  </head>", 1)
    return inject + html


def _install_otel(app: FastAPI, settings: Settings) -> None:
    if not settings.telemetry.otlpEndpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        log.warning("otel.not_installed", hint="pip install 'k-shui[otel]'")
        return
    provider = TracerProvider(
        resource=Resource.create({"service.name": "k-shui", "service.version": __version__})
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.telemetry.otlpEndpoint))
    )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    log.info("otel.enabled", endpoint=settings.telemetry.otlpEndpoint)


app_factory = create_app

__all__ = ["create_app", "lifespan"]
