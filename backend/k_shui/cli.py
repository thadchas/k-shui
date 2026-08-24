"""``k-shui`` command line: serve, init, check, version."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from k_shui import __version__
from k_shui.config import Settings, load_settings

app = typer.Typer(
    name="k-shui",
    help="k-shui — Kafka Streaming Hub UI. Open-source control center for Apache Kafka.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()

SAMPLE_CONFIG = """\
# k-shui configuration. Every value can also be set via environment variables using
# KSHUI__<SECTION>__<KEY> (e.g. KSHUI__SERVER__PORT=9000). ${VAR} and ${VAR:-default}
# are expanded from the environment inside string values.

server:
  host: 0.0.0.0
  port: 8090
  basePath: /            # set when serving behind an ingress sub-path
  cors: []               # extra allowed browser origins
  readOnly: false        # reject every mutating request

auth:
  type: none             # none | basic | oidc
  # users:               # for type: basic (password may be an argon2 hash or plaintext in dev)
  #   - username: admin
  #     password: admin
  #     role: admin      # admin | editor | viewer
  # oidc:
  #   issuer: https://keycloak.example.com/realms/main
  #   clientId: k-shui
  #   clientSecret: ${OIDC_CLIENT_SECRET}
  #   scopes: [openid, profile, email]
  #   rolesClaim: roles
  sessionHours: 12

database:
  url: sqlite+aiosqlite:///./k-shui.db     # or postgresql+asyncpg://user:pass@host/db

telemetry:
  metrics: true          # expose Prometheus metrics at /metrics
  otlpEndpoint: null     # OpenTelemetry OTLP/HTTP traces endpoint
  logFormat: console     # console | json
  logLevel: INFO

alerts:
  evaluationIntervalSeconds: 30
  historyRetentionDays: 30

clusters:
  - id: local                        # url-safe and unique
    name: Local Kafka
    bootstrapServers: localhost:9092
    properties: {}                   # raw librdkafka properties (security.protocol, sasl.*, ssl.*)
    readOnly: false
    metricsMode: sampled             # prometheus | sampled (admin-API ring buffer)
    pollIntervalSeconds: 15
    # schemaRegistry:
    #   url: http://localhost:8081
    #   type: confluent              # confluent | apicurio | karapace
    # connect:
    #   - name: connect
    #     url: http://localhost:8083
    # ksqldb:
    #   - name: ksql
    #     url: http://localhost:8088
    # flink:
    #   - name: flink
    #     url: http://localhost:8081
    # prometheus:
    #   url: http://localhost:9090
    #   labels: {cluster: local}
    # lineage:
    #   type: marquez
    #   url: http://localhost:5000/api/v1
"""


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"k-shui {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version", callback=_version_callback, is_eager=True, help="Show the version and exit."
        ),
    ] = False,
) -> None:
    """k-shui command line."""


@app.command()
def version() -> None:
    """Print the k-shui version."""
    console.print(f"k-shui {__version__}")


@app.command()
def init(
    output: Annotated[Path, typer.Option("--output", "-o", help="Where to write the sample config.")] = Path(
        "k-shui.yaml"
    ),
    force: Annotated[bool, typer.Option("--force", help="Overwrite an existing file.")] = False,
) -> None:
    """Write an annotated sample configuration file."""
    if output.exists() and not force:
        console.print(f"[red]{output} already exists[/red] — pass --force to overwrite.")
        raise typer.Exit(code=1)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(SAMPLE_CONFIG)
    console.print(f"[green]Wrote[/green] {output}")
    console.print(f"Start with: [bold]k-shui serve --config {output}[/bold]")


@app.command()
def serve(
    config: Annotated[Path | None, typer.Option("--config", "-c", help="Path to k-shui.yaml.")] = None,
    host: Annotated[str | None, typer.Option("--host", help="Bind address.")] = None,
    port: Annotated[int | None, typer.Option("--port", "-p", help="Bind port.")] = None,
    bootstrap_servers: Annotated[
        str | None,
        typer.Option("--bootstrap-servers", "-b", help="Kafka bootstrap servers (no config needed)."),
    ] = None,
    reload: Annotated[
        bool, typer.Option("--reload", help="Auto-reload on code changes (development).")
    ] = False,
    log_level: Annotated[str | None, typer.Option("--log-level", help="DEBUG|INFO|WARNING|ERROR.")] = None,
) -> None:
    """Run the k-shui server."""
    import uvicorn

    if bootstrap_servers:
        os.environ["KSHUI_BOOTSTRAP_SERVERS"] = bootstrap_servers
    if config:
        os.environ["KSHUI_CONFIG"] = str(config)
    settings = load_settings(config)
    if bootstrap_servers and settings.clusters:
        settings.clusters[0].bootstrapServers = bootstrap_servers
    bind_host = host or settings.server.host
    bind_port = port or settings.server.port
    if log_level:
        settings.telemetry.logLevel = log_level.upper()
        os.environ["KSHUI__TELEMETRY__LOGLEVEL"] = log_level.upper()

    console.print(f"[bold green]k-shui {__version__}[/bold green] → http://{bind_host}:{bind_port}")
    console.print(f"  config   : {settings.configPath or '(defaults)'}")
    console.print(f"  clusters : {', '.join(c.id for c in settings.clusters) or '(none)'}")
    console.print(f"  auth     : {settings.auth.type}")

    if reload:
        uvicorn.run(
            "k_shui.main:create_app",
            factory=True,
            host=bind_host,
            port=bind_port,
            reload=True,
            log_level=settings.telemetry.logLevel.lower(),
        )
        return
    from k_shui.main import create_app

    uvicorn.run(
        create_app(settings), host=bind_host, port=bind_port, log_level=settings.telemetry.logLevel.lower()
    )


@app.command()
def check(
    config: Annotated[Path | None, typer.Option("--config", "-c", help="Path to k-shui.yaml.")] = None,
    timeout: Annotated[float, typer.Option("--timeout", help="Per-endpoint timeout in seconds.")] = 8.0,
) -> None:
    """Connect to every cluster and integration and print a reachability table."""
    settings = load_settings(config)
    console.print(f"config: [bold]{settings.configPath or '(defaults)'}[/bold]")
    rows = asyncio.run(_check_all(settings, timeout))
    table = Table("cluster", "component", "target", "status", "detail", title="k-shui connectivity check")
    failures = 0
    for cluster, component, target, ok, detail in rows:
        if not ok:
            failures += 1
        table.add_row(
            cluster, component, target, "[green]ok[/green]" if ok else "[red]fail[/red]", (detail or "")[:80]
        )
    console.print(table)
    if failures:
        console.print(f"[yellow]{failures} component(s) unreachable[/yellow]")
        sys.exit(1)


async def _check_all(settings: Settings, timeout: float) -> list[tuple[str, str, str, bool, str]]:  # noqa: ASYNC109
    import httpx

    from k_shui.core.registry import ClusterRegistry
    from k_shui.kafka.admin import KafkaAdmin

    registry = ClusterRegistry(settings)
    rows: list[tuple[str, str, str, bool, str]] = []

    async def http_check(cluster: str, component: str, url: str, path: str = "") -> None:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url.rstrip("/") + path)
            rows.append((cluster, component, url, resp.status_code < 400, f"HTTP {resp.status_code}"))
        except Exception as exc:
            rows.append((cluster, component, url, False, str(exc)[:120]))

    for ctx in registry.all():
        cfg = ctx.config
        admin = KafkaAdmin(ctx, timeout=timeout)
        try:
            info = await admin.describe_cluster()
            rows.append(
                (
                    cfg.id,
                    "kafka",
                    cfg.bootstrapServers,
                    True,
                    f"{info['brokerCount']} broker(s), {info['topicCount']} topic(s), id={info['clusterId']}",
                )
            )
        except Exception as exc:
            rows.append((cfg.id, "kafka", cfg.bootstrapServers, False, str(exc)[:120]))
        await admin.close()

        if cfg.schemaRegistry:
            await http_check(cfg.id, "schemaRegistry", cfg.schemaRegistry.url, "/subjects")
        for c in cfg.connect:
            await http_check(cfg.id, f"connect:{c.name}", c.url, "/")
        for k in cfg.ksqldb:
            await http_check(cfg.id, f"ksql:{k.name}", k.url, "/info")
        for f in cfg.flink:
            await http_check(cfg.id, f"flink:{f.name}", f.url, "/overview")
        if cfg.prometheus:
            await http_check(cfg.id, "prometheus", cfg.prometheus.url, "/-/healthy")
        if cfg.lineage and cfg.lineage.type != "none" and cfg.lineage.url:
            await http_check(cfg.id, "lineage", cfg.lineage.url, "/namespaces")

    await registry.aclose()
    return rows


if __name__ == "__main__":
    app()
