# Getting started

k-shui Agent is the main workflow: ask about a cluster or resource, review the
scoped evidence it gathers, and, when explicitly enabled, review a supported
change before the k-shui engine executes and verifies it. The same engine also
powers the full management UI, enforces roles and read-only policy, and records
mutations in the audit log.

This walks through running k-shui, writing a first config, verifying
connectivity, and enabling that workflow. For the exhaustive config schema, see
[`deployment/configuration-reference.md`](deployment/configuration-reference.md).

> **Agent preview.** k-shui Agent is implemented and disabled by default, but it
> has not shipped in a published package and has not passed production
> evaluation. Read the
> [validation limits](roadmap.md#product-priority-investigations-and-reviewed-operations)
> and the [preview release gates](k-shui-agent.md#preview-release-gates) before
> you enable it.

## 1. Run k-shui

k-shui is built from source today. No package, image, or chart is published yet,
so start with one of the two source paths below; both serve the same application
on `:8090`.

### Demo stack with Docker Compose (recommended)

```bash
git clone https://github.com/thadchas/k-shui.git
cd k-shui
docker compose -f deploy/compose/docker-compose.yml up --build
# or: make compose-up
```

This builds the image from `deploy/docker/Dockerfile` and starts a single-node
Kafka plus k-shui at **http://localhost:8090**. It uses the checked-in
`deploy/compose/k-shui.yaml`, whose cluster id is `compose` and whose
`auth.type` is `none`. Add `--profile full` for Connect, Apicurio, Flink,
Prometheus, and Marquez. See
[`deployment/docker-compose.md`](deployment/docker-compose.md#quick-start-kafka--k-shui-only).

### Run from source with uv

```bash
make build-frontend   # builds the SPA into backend/k_shui/static (needs Node)
make run              # uv sync + k-shui serve --config deploy/examples/k-shui.local.yaml
```

`make run` on its own starts the API without a workspace bundle, so build the
frontend first if you want the UI; `make dev` runs the backend and the Vite dev
server together. To build and run the container by hand instead:

```bash
docker build -f deploy/docker/Dockerfile -t k-shui:local .
# or: make docker
docker run -p 8090:8090 \
  -e KSHUI_BOOTSTRAP_SERVERS=host.docker.internal:9092 \
  k-shui:local
```

Later sections write `k-shui <command>`; from a source checkout the equivalent
is `cd backend && uv run k-shui <command>`. See
[`deployment/standalone-uv.md`](deployment/standalone-uv.md) for the CLI,
sub-path serving, and systemd, and [`deployment/docker.md`](deployment/docker.md)
for the image layout and a config-file mount.

### Publication pending

The `k-shui` package, container image, and Helm chart are not published yet, so
the commands in this subsection do not work today. Registry publication is
tracked in [#59](https://github.com/thadchas/k-shui/issues/59); they are
recorded here so you know what the released paths will look like.

```bash
uvx k-shui serve                                   # PyPI package, not yet published
npx k-shui serve                                   # npm launcher, not yet published
docker run -p 8090:8090 \
  -e KSHUI_BOOTSTRAP_SERVERS=host.docker.internal:9092 \
  ghcr.io/thadchas/k-shui                          # image, not yet published
helm install k-shui oci://ghcr.io/thadchas/charts/k-shui \
  --namespace k-shui --create-namespace \
  -f my-values.yaml                                # OCI chart, not yet published
```

Meanwhile, [`deployment/standalone-uv.md`](deployment/standalone-uv.md#running-a-pre-release-or-locally-built-wheel)
runs a locally built wheel with `uvx --from <wheel>`, and
[`deployment/kubernetes-helm.md`](deployment/kubernetes-helm.md#install) installs
the in-repo `charts/k-shui` directory (or
[`deployment/kubernetes-kustomize.md`](deployment/kubernetes-kustomize.md) for
plain manifests).

Whichever path you take, open **http://localhost:8090**. These starts
intentionally do not activate k-shui Agent. The agent is disabled by default and
will not run with `auth.type: none`; enable it only after the base connection and
authentication are configured.

## 2. Your first config

With no config file, no `--config` flag, and no `$KSHUI_CONFIG`, k-shui
synthesizes a single cluster called `default` pointed at
`$KSHUI_BOOTSTRAP_SERVERS` (default `localhost:9092`) — enough to click around
against a local Kafka.

For anything real, write a config:

```bash
k-shui init                       # writes an annotated k-shui.yaml
# from source: cd backend && uv run k-shui init
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
mutations off while you validate investigations.

> **Before you enable this, decide about data and cost.** Questions and the
> operational metadata behind them — cluster metadata, metrics, redacted
> configuration, and bounded error summaries — are sent to the configured
> provider (the OpenAI or Anthropic API) and are subject to that provider's
> retention policies and terms. Provider usage is billed to your account.
> `maxRunCostUsd` and the per-million prices you configure are a local budget
> estimate computed from the rates you supply, not an invoice guarantee. Review
> the full data policy in [`k-shui-agent.md`](k-shui-agent.md#deployment) against
> your organization's data-sharing rules first.

The example below matches the `prod` cluster from section 2; `agent.allowedClusters`
and each connection's `allowedClusters` must list the `clusters[].id` values you
actually configured. For the Compose demo stack that id is `compose` — use the
Compose-specific fragment in
[`deployment/docker-compose.md`](deployment/docker-compose.md#enable-k-shui-agent).

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
