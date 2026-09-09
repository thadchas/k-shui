# Getting started

k-shui Agent is the main workflow: ask about a cluster or resource, review the
scoped evidence it gathers, and, when explicitly enabled, review a supported
change before the k-shui engine executes and verifies it. The same engine also
powers the full management UI, enforces roles and read-only policy, and records
mutations in the audit log.

This walks through installing k-shui, writing a first config, verifying
connectivity, and enabling that workflow. For the exhaustive config schema, see
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

The quick starts intentionally do not activate k-shui Agent. The agent is
disabled by default and will not run with `auth.type: none`; enable it only
after the base connection and authentication are configured.

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

## 4. Enable k-shui Agent

Add authenticated users and an administrator-managed AI connection to the
server config. Keep the provider key in the server process environment; it is
never entered in or stored by the browser. This minimal example keeps
mutations off while you validate investigations:

```yaml
auth:
  type: basic
  jwtSecret: ${KSHUI_JWT_SECRET}
  users:
    - username: admin
      password: ${KSHUI_ADMIN_PASSWORD_HASH}
      role: admin

agent:
  enabled: true
  allowMutations: false
  allowedClusters: [prod]
  maxRunCostUsd: 0.25
  connections:
    - id: operations-openai
      name: Operations OpenAI
      provider: openai
      model: ${KSHUI_AGENT_OPENAI_MODEL}
      apiKeyEnv: KSHUI_AGENT_OPENAI_KEY
      allowedClusters: [prod]
      inputUsdPerMillion: ${KSHUI_AGENT_INPUT_PRICE}
      outputUsdPerMillion: ${KSHUI_AGENT_OUTPUT_PRICE}
```

Supply `KSHUI_JWT_SECRET`, the password hash, model ID, current contracted
prices, and `KSHUI_AGENT_OPENAI_KEY` through your shell or deployment secret
manager, then restart k-shui. Paid runs are refused when either price is
missing. Run one k-shui application worker/process for now; agent run admission
and recovery do not support independently starting workers that share the same
database.

Sign in as the configured admin, open **AI connections** in Settings, and test
the connection. Add separately scoped editor/viewer accounts for routine use.
Then use **Ask K-Shui** in the top bar or **Investigate** from a consumer group,
unhealthy partition, connector, or alert. Inspect mode gathers bounded,
timestamped metadata and excludes message payloads. See
[`k-shui-agent.md`](k-shui-agent.md) for the data policy, provider support,
scope controls, and the narrower set of supported operations.

After investigations behave as expected, `agent.allowMutations: true` makes
Operate mode available to eligible editors and admins. Every proposed change
still requires an exact review/confirmation, current role and cluster access,
and writable server/cluster policy. The k-shui engine executes the reviewed
operation, verifies the result, and records audit evidence.

## 5. Use the management UI

k-shui's layout is a left sidebar (Cluster · Streaming · Governance ·
Observability · Admin groups) plus a topbar with breadcrumbs, global search
(`⌘K`), the alerts bell, and a refresh-interval/time-range picker. Routes:

| Route                         | Page                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/clusters`                   | Cluster picker — cards with health/throughput                                                                               |
| `/agent`, `/c/:cluster/agent` | New or saved agent investigation, optionally scoped to the selected cluster                                                 |
| `/agent/settings`             | Effective AI connections, data policy and administrator connection test                                                     |
| `/c/:cluster/overview`        | Stat tiles, throughput charts, health checks, KRaft quorum                                                                  |
| `/c/:cluster/brokers`         | Broker list → `/brokers/:id` (overview, configs, log dirs, metrics)                                                         |
| `/c/:cluster/topics`          | Topic list → `/topics/new`, `/topics/:topic` (overview, messages, partitions, configs, consumers, schema, metrics, lineage) |
| `/c/:cluster/consumers`       | Consumer groups → `/consumers/:group`, plus `/share-groups`                                                                 |
| `/c/:cluster/schemas`         | Schema Registry subjects → `/schemas/new`, `/schemas/:subject`                                                              |
| `/c/:cluster/connect`         | Connect clusters → `/connect/:kc`, connectors, `/connect/:kc/plugins`                                                       |
| `/c/:cluster/ksql`            | SQL editor + streams/tables/queries tabs                                                                                    |
| `/c/:cluster/flink`           | Flink clusters → jobs, task managers, `/sql`, `/jars`                                                                       |
| `/c/:cluster/replication`     | MirrorMaker2 / replicator view                                                                                              |
| `/c/:cluster/metrics`         | Dashboard list → `/metrics/:dashboard`, `/metrics/explore` (PromQL)                                                         |
| `/c/:cluster/lineage`         | Lineage graph canvas + side panel + search                                                                                  |
| `/c/:cluster/security`        | ACLs, quotas, SCRAM users                                                                                                   |
| `/c/:cluster/settings`        | Cluster dynamic configs, KRaft quorum                                                                                       |
| `/alerts`                     | History, triggers, actions                                                                                                  |
| `/audit`                      | Audit log of mutating actions                                                                                               |
| `/settings`                   | App settings, users (basic auth), about                                                                                     |

Use these pages to inspect the agent's linked evidence, handle workflows outside
the agent's supported operation set, and manage resources directly. Agent
mutations are intentionally narrower than the full UI. Each feature area has
its own walkthrough in [`docs/features/`](features/).

## Next steps

- [`docs/configuration.md`](configuration.md) — config quick reference
- [`docs/k-shui-agent.md`](k-shui-agent.md) — agent workflow, boundaries and operations
- [`docs/features/`](features/) — per-area walkthroughs and API endpoints
- [`docs/api.md`](api.md) — REST API overview
- [`docs/deployment/security-hardening.md`](deployment/security-hardening.md) — before exposing k-shui beyond localhost
