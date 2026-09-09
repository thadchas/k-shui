<div align="center">

# k-shui

**Open-source, agent-driven Kafka management**

**Agent preview** — k-shui Agent is implemented but not yet published or
production-evaluated. Read the
[validation limits](https://thadchas.github.io/k-shui-docs/next/roadmap/#product-priority-investigations-and-reviewed-operations)
and [preview release gates](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/#preview-release-gates) first.

[Website](https://thadchas.github.io/k-shui-website/) · [Getting started](https://thadchas.github.io/k-shui-docs/next/getting-started/) · [Documentation](https://thadchas.github.io/k-shui-docs/next/)

[![License](https://img.shields.io/github/license/thadchas/k-shui?color=0D9488)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/thadchas/k-shui/ci.yml?branch=main&label=CI&logo=github)](https://github.com/thadchas/k-shui/actions/workflows/ci.yml)
[![Distribution](https://img.shields.io/badge/distribution-publication%20pending%20(%2359)-8B9BB4)](https://github.com/thadchas/k-shui/issues/59)

</div>

k-shui helps you investigate and manage Apache Kafka and its streaming ecosystem
through **k-shui Agent**. Ask about a lagging consumer, investigate a failed
connector, or request a supported change. The agent gathers scoped evidence,
explains its findings, and prepares concrete operations for you to review.

The **k-shui engine** connects to your services, enforces permissions, executes
reviewed actions, and records their outcomes. A **visual workspace** gives you
resource pages, message browsing, dashboards, and lineage alongside the agent.
The project is Apache-2.0 licensed and connects to the clusters you already run.

[Get started](https://thadchas.github.io/k-shui-docs/next/getting-started/) · [Enable k-shui Agent](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/) · [Documentation](https://thadchas.github.io/k-shui-docs/next/)

## Ask, investigate, review, act

1. **Ask in context.** Open **Ask K-Shui** or a resource's **Investigate** action.
   Choose the cluster and resource you want to understand.
2. **Investigate with evidence.** Review linked observations, retrieval times,
   possible explanations, missing information, and next steps.
3. **Request a supported action.** In **Operate** mode, ask for a specific change
   and review its exact target, parameters, and effect.
4. **Execute and check the outcome.** Complete any required confirmation. The
   engine rechecks permissions and resource state, runs the operation, and
   records verification and audit evidence.

Start with questions such as **“Why is this consumer group falling behind?”**,
**“Explain this connector failure”**, or **“What is connected to this topic?”**
When you want a change, make it explicit: **“Restart task 2 on connector orders”**
or **“Prepare a retention change for topic orders to one day.”**

![k-shui Agent investigates scoped evidence, prepares changes for human review, and uses the k-shui engine to manage the Kafka ecosystem](https://thadchas.github.io/k-shui-docs/images/k-shui-agent-architecture.png)

## What the agent can do today

| Workflow            | Current capability                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Investigate         | Cluster health, topic metadata, consumer lag and membership, connector task states, streaming-job/checkpoint summaries, schema summaries, lineage neighbors, alert evidence, and recent audit headers              |
| Explain             | Findings linked to retrieved evidence, possible explanations, missing information, and next steps                                                                                                                  |
| Prepare and operate | Create topics, update supported topic settings, pause/resume/restart connectors, restart individual connector tasks, delete/purge topics, increase partitions, and reset consumer offsets with the required checks |
| Preserve context    | Scoped investigations, saved history, progress, cancellation, and bounded tool/time/usage limits                                                                                                                   |

**Inspect mode makes no changes.** Operations are a defined subset of the
workspace's capabilities; the agent does not have arbitrary shell, SQL, or
message-payload access. Missing evidence and uncertain outcomes remain visible.
See the [agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/) for exact operation boundaries.

**Agent setup is explicit:** the agent is disabled by default. An administrator
must enable it, configure an AI connection and usage rates, and require user
sign-in. Mutations are a separate opt-in. The current agent runs in one
application worker/process; see [deployment requirements](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/#deployment).

## Visual workspace and ecosystem coverage

Use resource pages to examine the evidence behind an investigation and perform
expert workflows beyond the agent's supported tools. The table below describes
the whole application, not a promise that every operation is agent-accessible.

| Area                     | What you get                                                                                                                                                                                                                 | Docs                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Clusters                 | Multi-cluster switcher, health checks, throughput, KRaft-aware overview                                                                                                                                                      | [Guide](https://thadchas.github.io/k-shui-docs/next/features/clusters/)           |
| Brokers                  | Config editor, log dirs, per-broker metrics                                                                                                                                                                                  | [Guide](https://thadchas.github.io/k-shui-docs/next/features/brokers/)            |
| Topics                   | Create/configure/delete, partition add, targeted purge, clone, config diffing, partition health, preferred-leader election, reassignment plans                                                                               | [Guide](https://thadchas.github.io/k-shui-docs/next/features/topics/)             |
| Message browser          | Live tail with pause/resume, per-partition seek, produce, JSON/Avro/Protobuf/JSON Schema decode, key/value/header filters (JSONPath/regex), tombstones, CSV/NDJSON export                                                    | [Guide](https://thadchas.github.io/k-shui-docs/next/features/messages/)           |
| Consumers & share groups | Lag in offsets and time, member→partition assignments with skew, dry-run offset reset (earliest/latest/timestamp/shift, partition-scoped), Kafka 4.x share groups                                                            | [Guide](https://thadchas.github.io/k-shui-docs/next/features/consumers/)          |
| Schema Registry          | Confluent / Apicurio / Karapace — subjects, versions, diff, compatibility check                                                                                                                                              | [Guide](https://thadchas.github.io/k-shui-docs/next/features/schemas/)            |
| Kafka Connect            | Connector CRUD, pause/resume/restart, task status, plugin validation, MirrorMaker2 replication view                                                                                                                          | [Guide](https://thadchas.github.io/k-shui-docs/next/features/connect/)            |
| ksqlDB                   | SQL editor with streaming results, streams/tables/queries, statement history                                                                                                                                                 | [Guide](https://thadchas.github.io/k-shui-docs/next/features/ksqldb/)             |
| Flink                    | Jobs, checkpoints, execution graph, task managers, jar upload/run, SQL Gateway                                                                                                                                               | [Guide](https://thadchas.github.io/k-shui-docs/next/features/flink/)              |
| Metrics                  | Prometheus-backed dashboards (Grafana-JSON import), PromQL explorer, sampled fallback                                                                                                                                        | [Guide](https://thadchas.github.io/k-shui-docs/next/features/metrics/)            |
| Stream lineage           | OpenLineage/Marquez graph merged with derived Connect/ksqlDB/Flink/consumer edges                                                                                                                                            | [Guide](https://thadchas.github.io/k-shui-docs/next/features/lineage/)            |
| Alerts                   | Metric-based triggers, buffered conditions, email/Slack/PagerDuty/Teams/webhook actions, history                                                                                                                             | [Guide](https://thadchas.github.io/k-shui-docs/next/features/alerts/)             |
| Security                 | ACLs, quotas, SCRAM users, KRaft quorum view                                                                                                                                                                                 | [Guide](https://thadchas.github.io/k-shui-docs/next/features/security/)           |
| Settings & audit         | Cluster dynamic configs, full audit log of mutating actions                                                                                                                                                                  | [Guide](https://thadchas.github.io/k-shui-docs/next/features/settings-and-audit/) |
| Auth & RBAC              | None / basic (admin, editor, viewer) / OIDC enforced on every API and mirrored in the UI, light & dark theme, keyboard-first ([shortcuts](https://thadchas.github.io/k-shui-docs/next/features/keyboard-and-accessibility/)) | [Guide](https://thadchas.github.io/k-shui-docs/next/features/auth-rbac/)          |

## Operator safety model

Every agent operation and visual workflow must respect the acting user's authority:

- **Reviewed agent operations** — exact previews, permission and resource-state
  rechecks, expiring operation identifiers, and recorded outcomes. A diagnostic
  question does not authorize a change.
- **Typed confirmation** for every irreversible action (delete/purge/add
  partitions, ACL and quota removal, Flink cancel, ksqlDB terminate), and a
  mandatory **dry-run preview** before any offset reset.
- **Internal topics** (`__consumer_offsets`, …) have destructive actions
  locked; compacted topics warn before partitions are added.
- **RBAC everywhere** — viewers see the same pages with mutating controls
  disabled, and the API rejects them with `403` regardless of the UI.
- **Secrets stay masked** — connector passwords, tokens, and keystores are
  hidden in every view and can never be saved back as placeholders.
- **Every mutation is audited**, and destructive dialogs explain the
  operational consequence ("offsets survive connector delete", "purge advances
  the start offset") rather than just asking "are you sure?".

## Quick start

k-shui is built from source today; no package, image, or chart is published yet.
These commands open the visual workspace; they do not enable the agent by
themselves.

### Demo stack with Docker Compose (recommended)

```bash
git clone https://github.com/thadchas/k-shui.git
cd k-shui
docker compose -f deploy/compose/docker-compose.yml up --build   # or: make compose-up
```

This builds the image from `deploy/docker/Dockerfile` and starts a single-node
Kafka plus k-shui at **http://localhost:8090**, using
`deploy/compose/k-shui.yaml` (cluster id `compose`, `auth.type: none`). Add
`--profile full` for Connect, Apicurio, Flink, Prometheus, and Marquez. See
[the Docker Compose guide](https://thadchas.github.io/k-shui-docs/next/deployment/docker-compose/).

### Run from source with uv

```bash
make build-frontend   # builds the SPA into backend/k_shui/static (needs Node)
make run              # uv sync + k-shui serve --config deploy/examples/k-shui.local.yaml
```

`make run` alone starts the API without the built workspace, so run
`make build-frontend` first for the UI. `make dev` runs the backend and the Vite
dev server together. To build and run the container by hand:

```bash
docker build -f deploy/docker/Dockerfile -t k-shui:local .   # or: make docker
docker run -p 8090:8090 -e KSHUI_BOOTSTRAP_SERVERS=host.docker.internal:9092 k-shui:local
```

With no config file at all, k-shui starts with a single cluster pointed at
`localhost:9092` (or `$KSHUI_BOOTSTRAP_SERVERS`).

### Publication pending

The `k-shui` package, image, and chart are not published yet, so the commands
below do not work today. Registry publication is tracked in
[#59](https://github.com/thadchas/k-shui/issues/59); they are listed so you know
what the released paths will look like.

```bash
# uv (no local Python install needed)
uvx k-shui serve

# npx (requires Node.js; launches the application through uv or Docker)
npx k-shui serve

# Docker
docker run -p 8090:8090 -e KSHUI_BOOTSTRAP_SERVERS=host.docker.internal:9092 ghcr.io/thadchas/k-shui

# Helm, on Kubernetes
helm install k-shui oci://ghcr.io/thadchas/charts/k-shui
```

Until then, `uvx --from <wheel> k-shui serve` runs a locally built wheel
([the uv / uvx guide](https://thadchas.github.io/k-shui-docs/next/deployment/standalone-uv/)) and
`helm upgrade --install k-shui charts/k-shui` installs the in-repo chart
([the Helm guide](https://thadchas.github.io/k-shui-docs/next/deployment/kubernetes-helm/)).

### Connect your ecosystem

Generate one with `k-shui init`, or start from this:

```yaml
# k-shui.yaml
server:
  port: 8090

clusters:
  - id: prod
    name: Production
    bootstrapServers: kafka-0:9092,kafka-1:9092,kafka-2:9092
    schemaRegistry:
      url: http://schema-registry:8081
      type: confluent
    connect:
      - name: connect
        url: http://connect:8083
    prometheus:
      url: http://prometheus:9090
```

```bash
k-shui serve --config k-shui.yaml
```

See [the getting-started guide](https://thadchas.github.io/k-shui-docs/next/getting-started/) for the full install
walkthrough and [the configuration reference](https://thadchas.github.io/k-shui-docs/next/deployment/configuration-reference/)
for every field.

### Enable your first agent investigation

Follow the [agent setup guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/#deployment) to configure
sign-in, an AI connection, model usage rates, and permitted clusters. Keep
`agent.allowMutations: false` for your first investigation. Restart the
application, sign in, test the configured connection, and open **Ask K-Shui**
in **Inspect** mode. See [getting started](https://thadchas.github.io/k-shui-docs/next/getting-started/) for the
complete walkthrough.

## Visual workspace screenshots

| Cluster overview                                                                | Message browser                                                                     | Stream lineage                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ![Cluster overview](https://thadchas.github.io/k-shui-docs/images/overview.png) | ![Message browser](https://thadchas.github.io/k-shui-docs/images/messages.png)      | ![Stream lineage](https://thadchas.github.io/k-shui-docs/images/lineage.png) |
| Topics                                                                          | Consumer group                                                                      | Alerts                                                                       |
| ![Topics](https://thadchas.github.io/k-shui-docs/images/topics.png)             | ![Consumer group](https://thadchas.github.io/k-shui-docs/images/consumer-group.png) | ![Alerts](https://thadchas.github.io/k-shui-docs/images/alerts.png)          |
| Schemas                                                                         | Kafka Connect                                                                       | Flink job                                                                    |
| ![Schemas](https://thadchas.github.io/k-shui-docs/images/schemas.png)           | ![Kafka Connect](https://thadchas.github.io/k-shui-docs/images/connect.png)         | ![Flink job](https://thadchas.github.io/k-shui-docs/images/flink-job.png)    |

Shown in dark theme. The documentation image store also carries light-theme
captures of the clusters, overview, topics and message-browser screens —
`clusters-light.png`, `overview-light.png`, `topics-light.png` and
`messages-light.png`, browsable in
[the documentation repository](https://github.com/thadchas/k-shui-docs/tree/main/content/images).

## Connect to your existing stack

k-shui speaks plain Kafka Admin protocol plus the standard HTTP APIs of each
integration. No collector agent or sidecar is required on your brokers;
**k-shui Agent** runs within the application.

<details>
<summary><b>Strimzi</b> (Kubernetes-native Kafka)</summary>

```yaml
clusters:
  - id: strimzi
    name: Strimzi cluster
    bootstrapServers: my-cluster-kafka-bootstrap.kafka.svc:9092
    properties:
      security.protocol: SSL
      ssl.ca.location: /etc/k-shui/certs/ca.crt
    schemaRegistry:
      url: http://my-cluster-registry.kafka.svc:8081
      type: apicurio
```

</details>

<details>
<summary><b>Confluent Platform / Confluent Cloud</b></summary>

```yaml
clusters:
  - id: confluent-cloud
    name: Confluent Cloud
    bootstrapServers: pkc-xxxxx.us-east-1.aws.confluent.cloud:9092
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: PLAIN
      sasl.username: ${CCLOUD_API_KEY}
      sasl.password: ${CCLOUD_API_SECRET}
    schemaRegistry:
      url: https://psrc-xxxxx.us-east-2.aws.confluent.cloud
      type: confluent
      auth: {username: ${SR_API_KEY}, password: ${SR_API_SECRET}}
```

</details>

<details>
<summary><b>Amazon MSK</b></summary>

```yaml
clusters:
  - id: msk
    name: MSK
    bootstrapServers: b-1.mycluster.abc123.c2.kafka.us-east-1.amazonaws.com:9098
    properties:
      security.protocol: SASL_SSL
      sasl.mechanism: AWS_MSK_IAM
```

</details>

<details>
<summary><b>Redpanda</b></summary>

```yaml
clusters:
  - id: redpanda
    name: Redpanda
    bootstrapServers: redpanda-0:9092
    schemaRegistry:
      url: http://redpanda-0:8081
      type: confluent # Redpanda's schema registry is Confluent-API compatible
```

</details>

<details>
<summary><b>Apicurio Registry</b></summary>

```yaml
schemaRegistry:
  url: http://apicurio:8080/apis/ccompat/v7
  type: apicurio
```

</details>

<details>
<summary><b>Flink Kubernetes Operator</b></summary>

```yaml
flink:
  - name: session
    url: http://my-flink-session.flink.svc:8081
    sqlGatewayUrl: http://my-flink-sql-gateway.flink.svc:8083
```

</details>

## Product architecture

| Component               | Responsibility                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **k-shui Agent**        | Investigates questions, explains evidence, and prepares supported changes                                      |
| **k-shui engine**       | Connects services, checks authority, executes reviewed operations, and records verification and audit evidence |
| **Visual workspace**    | Presents resources, messages, dashboards, lineage, and investigation history                                   |
| **Connected ecosystem** | Your Kafka clusters, connectors, registries, streaming processors, metrics, and lineage services               |

The agent uses bounded tools under the signed-in user's authority. The visual
workspace and agent share the engine's resource integrations; connected
streaming services continue to run the workloads.

See [architecture](https://thadchas.github.io/k-shui-docs/next/architecture/) for implementation details and
[the platform contract](ARCHITECTURE.md) for configuration and API behavior.

## Deployment

| Method                                        | Guide                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Docker Compose (demo stack, from source)      | [Docker Compose guide](https://thadchas.github.io/k-shui-docs/next/deployment/docker-compose/)             |
| Docker (local build; image pending)           | [Docker guide](https://thadchas.github.io/k-shui-docs/next/deployment/docker/)                             |
| uv / uvx (publication pending)                | [uv / uvx guide](https://thadchas.github.io/k-shui-docs/next/deployment/standalone-uv/)                    |
| npx (publication pending)                     | [npx guide](https://thadchas.github.io/k-shui-docs/next/deployment/standalone-npx/)                        |
| Kubernetes: Helm (in-repo chart; OCI pending) | [Helm guide](https://thadchas.github.io/k-shui-docs/next/deployment/kubernetes-helm/)                      |
| Kubernetes: Kustomize                         | [Kustomize guide](https://thadchas.github.io/k-shui-docs/next/deployment/kubernetes-kustomize/)            |
| Security hardening                            | [Security hardening guide](https://thadchas.github.io/k-shui-docs/next/deployment/security-hardening/)     |
| Full configuration reference                  | [Configuration reference](https://thadchas.github.io/k-shui-docs/next/deployment/configuration-reference/) |

## How it compares

Evaluate k-shui around its investigation-to-action workflow: scoped evidence,
reviewed operations, and the resource workspace that supports both. The
[comparison guide](https://thadchas.github.io/k-shui-docs/next/comparison/) covers ecosystem capabilities and a
migration map. Agent access is narrower than the application's full feature set;
use the [agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/) when evaluating operational coverage.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for local
setup (`make dev`), the repo layout, and coding standards, and
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the REST/config contract every change
should respect. Please also read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and
[`SECURITY.md`](SECURITY.md) (vulnerability reporting).

This repository holds the application, its packaging and its release tooling.
The guides and screenshots live in
[`thadchas/k-shui-docs`](https://github.com/thadchas/k-shui-docs) and the
marketing page and brand assets in
[`thadchas/k-shui-website`](https://github.com/thadchas/k-shui-website) — a
change to user-facing behavior usually needs a pull request there too. The
generated half of the reference (OpenAPI, configuration schema) is produced from
this repository at release time; see [`RELEASING.md`](RELEASING.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). Apache Kafka®, Apache Flink®, and
Apache® are trademarks of the Apache Software Foundation. k-shui is not affiliated
with or endorsed by the ASF or Confluent, Inc.
