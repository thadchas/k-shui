# Getting started

This walks through installing k-shui, writing a first config, verifying
connectivity, and touring the UI. For the exhaustive config schema, see
[`deployment/configuration-reference.md`](deployment/configuration-reference.md).

## 1. Install and run

Pick whichever fits your environment — all four run the same application.

### uv / uvx (recommended for local use)

```bash
uvx k-shui serve
```

No install step; `uvx` caches an ephemeral environment. To install it as a
persistent tool instead: `uv tool install k-shui`, then run `k-shui serve`.
See [`deployment/standalone-uv.md`](deployment/standalone-uv.md).

### npx

```bash
npx k-shui serve
```

The npm package is a launcher, not a reimplementation — it runs the real
Python CLI via `uv`/`pipx` (installing `uv` on first use if neither is
present), or via `--docker` to skip Python entirely. See
[`deployment/standalone-npx.md`](deployment/standalone-npx.md).

### Docker

```bash
docker run -p 8090:8090 \
  -e KSHUI_BOOTSTRAP_SERVERS=host.docker.internal:9092 \
  ghcr.io/thadchas/k-shui
```

See [`deployment/docker.md`](deployment/docker.md) for a config-file mount and
[`deployment/docker-compose.md`](deployment/docker-compose.md) for a full demo
stack (Kafka, Connect, Apicurio, Flink, Prometheus, Marquez).

### Kubernetes (Helm)

```bash
helm install k-shui oci://ghcr.io/thadchas/charts/k-shui \
  --namespace k-shui --create-namespace \
  -f my-values.yaml
```

See [`deployment/kubernetes-helm.md`](deployment/kubernetes-helm.md) (or
[`deployment/kubernetes-kustomize.md`](deployment/kubernetes-kustomize.md) for
plain-manifest fans).

All four start a server on `:8090`. Open **http://localhost:8090**.

## 2. Your first config

With no config file, no `--config` flag, and no `$KSHUI_CONFIG`, k-shui
synthesizes a single cluster called `default` pointed at
`$KSHUI_BOOTSTRAP_SERVERS` (default `localhost:9092`) — enough to click around
against a local Kafka.

For anything real, write a config:

```bash
k-shui init                       # writes an annotated k-shui.yaml
# or: uvx k-shui init / npx k-shui init
```

Edit the generated file, at minimum setting `clusters[].bootstrapServers`:

```yaml
server:
  port: 8090

clusters:
  - id: prod
    name: Production
    bootstrapServers: kafka-0:9092,kafka-1:9092,kafka-2:9092
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: PLAIN
      sasl.username: ${KAFKA_USERNAME}
      sasl.password: ${KAFKA_PASSWORD}
    schemaRegistry:
      url: http://schema-registry:8081
      type: confluent
    connect:
      - name: connect
        url: http://connect:8083
    prometheus:
      url: http://prometheus:9090
```

`${VAR}` / `${VAR:-default}` inside string values are expanded from the process
environment, so secrets can live in your shell/secret-manager rather than the
file. k-shui looks for a config file in this order: `--config`, `$KSHUI_CONFIG`,
`./k-shui.yaml`, `./k-shui.yml`, `~/.config/k-shui/config.yaml`,
`/etc/k-shui/config.yaml`.

```bash
k-shui serve --config k-shui.yaml
# or without a file at all, for a quick local look:
k-shui serve --bootstrap-servers localhost:9092
```

Every setting can also be overridden with `KSHUI__<SECTION>__<KEY>` env vars
(e.g. `KSHUI__SERVER__PORT=9000`, `KSHUI__AUTH__TYPE=basic`) — see the
[configuration reference](deployment/configuration-reference.md) for the full
field list, including `auth`, `database`, `telemetry` and `alerts`.

## 3. Verify with `k-shui check`

Before opening the UI, confirm k-shui can actually reach everything in your
config:

```bash
k-shui check --config k-shui.yaml
```

This connects to every configured cluster and every configured integration
(schema registry, Connect, ksqlDB, Flink, Prometheus, lineage) and prints a
reachability table, e.g.:

```
config: k-shui.yaml
     k-shui connectivity check
┏━━━━━━━━━┳━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ cluster ┃ component      ┃ target                ┃ status ┃ detail                      ┃
┡━━━━━━━━━╇━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ prod    │ kafka          │ kafka-0:9092,...      │ ok     │ 3 broker(s), 42 topic(s)... │
│ prod    │ schemaRegistry │ http://schema-reg:8081│ ok     │ HTTP 200                    │
│ prod    │ connect:connect│ http://connect:8083   │ fail   │ Connection refused          │
└─────────┴────────────────┴───────────────────────┴────────┴─────────────────────────────┘
1 component(s) unreachable
```

It exits non-zero if anything failed, so it's suitable for CI/deploy smoke
tests. A failed integration doesn't stop k-shui from starting — pages for that
integration show a "not reachable" empty state instead (see
[Non-functional requirements](../ARCHITECTURE.md#non-functional-requirements)).

## 4. Tour of the UI

k-shui's layout is a left sidebar (Cluster · Streaming · Governance ·
Observability · Admin groups) plus a topbar with breadcrumbs, global search
(`⌘K`), the alerts bell, and a refresh-interval/time-range picker. Routes:

| Route | Page |
|---|---|
| `/clusters` | Cluster picker — cards with health/throughput |
| `/c/:cluster/overview` | Stat tiles, throughput charts, health checks, KRaft quorum |
| `/c/:cluster/brokers` | Broker list → `/brokers/:id` (overview, configs, log dirs, metrics) |
| `/c/:cluster/topics` | Topic list → `/topics/new`, `/topics/:topic` (overview, messages, partitions, configs, consumers, schema, metrics, lineage) |
| `/c/:cluster/consumers` | Consumer groups → `/consumers/:group`, plus `/share-groups` |
| `/c/:cluster/schemas` | Schema Registry subjects → `/schemas/new`, `/schemas/:subject` |
| `/c/:cluster/connect` | Connect clusters → `/connect/:kc`, connectors, `/connect/:kc/plugins` |
| `/c/:cluster/ksql` | SQL editor + streams/tables/queries tabs |
| `/c/:cluster/flink` | Flink clusters → jobs, task managers, `/sql`, `/jars` |
| `/c/:cluster/replication` | MirrorMaker2 / replicator view |
| `/c/:cluster/metrics` | Dashboard list → `/metrics/:dashboard`, `/metrics/explore` (PromQL) |
| `/c/:cluster/lineage` | Lineage graph canvas + side panel + search |
| `/c/:cluster/security` | ACLs, quotas, SCRAM users |
| `/c/:cluster/settings` | Cluster dynamic configs, KRaft quorum |
| `/alerts` | History, triggers, actions |
| `/audit` | Audit log of mutating actions |
| `/settings` | App settings, users (basic auth), about |

Each feature area has its own walkthrough in [`docs/features/`](features/).

## Next steps

- [`docs/configuration.md`](configuration.md) — config quick reference
- [`docs/features/`](features/) — per-area walkthroughs and API endpoints
- [`docs/api.md`](api.md) — REST API overview
- [`docs/deployment/security-hardening.md`](deployment/security-hardening.md) — before exposing k-shui beyond localhost
