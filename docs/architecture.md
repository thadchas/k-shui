# Architecture

k-shui is a single deployable: a FastAPI backend that serves both a REST/SSE
API and the built React SPA, talking outward to a Kafka cluster's Admin API
and to whichever ecosystem integrations you've configured. This page covers
the component layout, request flow, data stores, and background jobs. For
the full REST/config contract, see [`../ARCHITECTURE.md`](../ARCHITECTURE.md);
for how each feature uses this, see [`features/`](features/).

## Components

```mermaid
flowchart TB
    subgraph Client
        SPA["React 19 SPA\nreact-router, TanStack Query"]
    end

    subgraph Backend["k_shui (FastAPI, one process)"]
        API["api/routers/*\n/api/v1"]
        Core["core/\nregistry, auth, audit, events (SSE bus)"]
        KafkaLayer["kafka/\nadmin, consumer, producer, serdes"]
        Integrations["integrations/\nschema_registry, connect, ksql, flink,\nprometheus, lineage, alerts"]
        DB["db/\nSQLAlchemy async"]
        Sched["asyncio tasks\nmetrics sampler + alert engine"]
    end

    subgraph External
        Kafka[("Apache Kafka\n(Admin protocol)")]
        SR["Schema Registry\n(Confluent/Apicurio/Karapace)"]
        Connect["Kafka Connect"]
        Ksql["ksqlDB"]
        Flink["Flink REST / SQL Gateway"]
        Prom["Prometheus"]
        Marquez["Marquez"]
        Store[("SQLite / Postgres")]
    end

    SPA -- "fetch / SSE" --> API
    API --> Core
    API --> KafkaLayer --> Kafka
    API --> Integrations
    Integrations --> SR
    Integrations --> Connect
    Integrations --> Ksql
    Integrations --> Flink
    Integrations --> Prom
    Integrations --> Marquez
    Core --> DB --> Store
    Sched --> Integrations
    Sched --> Core
```

- **Frontend** (`frontend/`) — Vite + React 19 + TypeScript + Tailwind v4.
  `api/client.ts` wraps `fetch`/SSE; `api/hooks/` are TanStack Query hooks;
  `pages/` has one folder per feature area; `layouts/AppShell` is the
  sidebar/topbar/cluster-switcher/command-palette shell. Built output is
  copied into `backend/k_shui/static/` and served by the backend — there is
  no separate frontend server in production.
- **Backend** (`backend/k_shui/`) — Python 3.11+, FastAPI.
  - `api/routers/*` — one module per feature area (`topics.py`, `connect.py`,
    `flink.py`, `alerts.py`, ...), auto-registered from `api/__init__.py`'s
    `ROUTER_MODULES` list (a missing/unimportable module is skipped rather
    than crashing startup — useful while a router is still being built).
  - `core/` — `registry.py` (`ClusterRegistry`, holds one context per
    configured cluster: its Admin client, integration clients, and config),
    `auth.py` (users/roles/JWT/OIDC), `audit.py`, `events.py` (the in-process
    SSE fan-out bus feeding `GET /events`), `errors.py` (RFC 9457
    problem+json).
  - `kafka/` — `admin.py` (topics/brokers/configs/ACLs/quotas/KRaft via
    `confluent-kafka`'s Admin client), `consumer.py` (message browsing),
    `producer.py`, `serdes/` (string/json/avro/protobuf/jsonschema, resolving
    against whichever schema registry is configured).
  - `integrations/` — one module per external system, each a thin,
    timeout-guarded HTTP client that raises `IntegrationNotConfigured` (404)
    or `IntegrationUnavailable` (503) rather than propagating a raw
    connection error; `alerts/` holds the trigger evaluation engine and
    notifier implementations (email/Slack/PagerDuty/webhook/Teams).
  - `db/` — SQLAlchemy 2 async models/session, default `sqlite+aiosqlite`,
    optional Postgres via the `postgres` extra.

## Request flow

1. Browser calls `/api/v1/...` (or opens an SSE connection) with a bearer
   token (if auth is enabled).
2. FastAPI dependency (`core/deps.py`) resolves the authenticated principal
   and the target `ClusterRegistry` context for `{cluster}` in the path.
3. The router handler calls into `kafka/admin.py` and/or an `integrations/*`
   client, using that cluster's configured connection details.
4. Mutating calls are recorded via `core/audit.py` before returning, and
   (where relevant) publish an event onto `core/events.py`'s bus for `/events`
   subscribers.
5. Errors from an unreachable/unconfigured integration are translated to
   `problem+json` with `integration-unavailable`/`integration-not-configured`
   — the rest of the app keeps working even if e.g. Flink is down.
6. Non-API paths fall through to the built SPA's `index.html` (client-side
   routing), except recognized reserved prefixes (`api/`, `docs`, `redoc`,
   `openapi.json`, `metrics`, `healthz`, `readyz`).

## Data stores

| Store                 | Holds                                                                                                                                | Default                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Kafka cluster itself  | Topics, configs, ACLs, quotas, offsets — the source of truth for everything Kafka-native                                             | —                                                                                                   |
| k-shui's own database | Basic-auth users (if not OIDC), alert triggers/actions/history, user-created metrics dashboards, ksqlDB statement history, audit log | `sqlite+aiosqlite:///./k-shui.db`; `postgresql+asyncpg://...` for multi-replica/durable deployments |
| In-memory ring buffer | Sampled metrics when `metricsMode: sampled` (no Prometheus)                                                                          | Process memory — resets on restart                                                                  |
| Prometheus (external) | Time-series metrics when configured                                                                                                  | —                                                                                                   |
| Marquez (external)    | OpenLineage jobs/datasets/runs when configured                                                                                       | —                                                                                                   |

SQLite is fine for a single replica; for multi-replica deployments (Helm
`replicaCount > 1` or `autoscaling.enabled`), point `database.url` at Postgres
so alert state, dashboards, and audit history are shared rather than
replica-local.

## Background jobs

Two asyncio background tasks inside the same process run recurring jobs:

- **Metrics sampler** — every `clusters[].pollIntervalSeconds` (default 15s),
  polls the Admin API per cluster and appends to the in-memory ring buffer
  used by `metricsMode: sampled` fallback charts.
- **Alert engine** — every `alerts.evaluationIntervalSeconds` (default 30s),
  evaluates every enabled trigger against live data (Admin API or
  Prometheus depending on the metric), applies each trigger's `bufferSeconds`
  hysteresis, fires configured actions on state transitions, records history,
  and emits `alert.fired`/`alert.resolved` SSE events. See
  [`features/alerts.md`](features/alerts.md).

Both run in-process — no external scheduler/queue is required, but it also
means alert evaluation and metrics sampling only happen on a _running_
replica; in a multi-replica deployment, ensure exactly the intended number of
replicas are actually up (the background tasks are not distributed/leader-elected
across replicas as of this version — see the [roadmap](roadmap.md)).

## Non-functional design

- Every integration failure degrades gracefully (`503 problem+json`,
  `integration-unavailable`) instead of crashing the app or the page.
- Structured JSON logs (`structlog`), optional OpenTelemetry traces
  (`telemetry.otlpEndpoint`, `otel` extra), Prometheus metrics on `/metrics`.
- CSP header, CSRF-safe token auth, sensitive config values masked in
  responses/logs/audit, login rate-limited.
- Frontend: strict TypeScript, paginated/virtualized lists, loading/empty/
  error states on every page, `⌘K` command palette, responsive down to
  768px.
