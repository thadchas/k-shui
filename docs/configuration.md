# Configuration

k-shui is configured with a single YAML file (`k-shui.yaml` by default), with
scalar fields overridable through `KSHUI__<SECTION>__<KEY>` environment variables.
k-shui Agent is the intended investigation workflow, while the k-shui engine
owns authorization, execution, verification, and audit. Agent access is an
explicit deployment choice: it defaults off, requires authentication, and uses
server-managed AI connections. This page is a two-minute orientation — the
full field-by-field reference (types, defaults, env var names) lives in
[`deployment/configuration-reference.md`](deployment/configuration-reference.md).

## The shape of it

```yaml
server: { host, port, basePath, cors, readOnly }
auth: { type: none|basic|oidc, users: [...], oidc: { ... }, sessionHours }
database: { url } # sqlite+aiosqlite:// (default) or postgresql+asyncpg://
telemetry: { metrics, otlpEndpoint, logFormat, logLevel }
alerts: { evaluationIntervalSeconds, historyRetentionDays, smtp }
agent:
  enabled: false
  allowMutations: false
  allowedClusters: null
  allowedTools: null
  maxToolCalls: 8
  maxRunSeconds: 60
  maxInputChars: 24000
  maxOutputTokens: 2048
  maxRunCostUsd: 0.25
  maxConcurrentRuns: 4
  connections:
    [
      {
        id,
        name,
        provider,
        model,
        apiKeyEnv,
        allowedClusters,
        allowedTools,
        inputUsdPerMillion,
        outputUsdPerMillion,
      },
    ]
clusters:
  - id: prod
    bootstrapServers: kafka-0:9092
    properties: {} # security.protocol, sasl.*, ssl.* — raw librdkafka
    schemaRegistry: { url, type: confluent|apicurio|karapace }
    connect: [{ name, url }]
    ksqldb: [{ name, url }]
    flink: [{ name, url, sqlGatewayUrl }]
    prometheus: { url, labels }
    lineage: { type: marquez|none, url, namespaces }
    metricsMode: sampled # auto-switches to prometheus once prometheus: is set
```

Every integration block (`schemaRegistry`, `connect[]`, `ksqldb[]`, `flink[]`,
`prometheus`, `lineage`) is optional and independent — configure only what you
run. Pages for an unconfigured or unreachable integration show a "not
configured" / "not reachable" state instead of breaking the app.

## Where k-shui looks for the file

`--config PATH` → `$KSHUI_CONFIG` → `./k-shui.yaml` → `./k-shui.yml` →
`~/.config/k-shui/config.yaml` → `/etc/k-shui/config.yaml`. With none found, a
single `default` cluster is synthesized from `$KSHUI_BOOTSTRAP_SERVERS`
(default `localhost:9092`).

## Secrets

String values support `${VAR}` and `${VAR:-default}` expansion from the
process environment, so credentials never need to sit in the YAML file itself
— see [`deployment/security-hardening.md`](deployment/security-hardening.md)
and, on Kubernetes, [`deployment/kubernetes-helm.md`](deployment/kubernetes-helm.md)
(`existingSecret` → env vars → `${VAR}` expansion).

For agent connections, `apiKeyEnv` is the _name_ of an environment variable
available to the k-shui server; the browser never receives the key. Keep the
model and the deployment's contracted input/output prices explicit and current.
Missing prices prevent paid runs. See [`k-shui-agent.md`](k-shui-agent.md) for a
complete enablement example and operating boundaries.

## Agent policy

`agent.enabled: true` alone is insufficient: `auth.type` must be `basic` or
`oidc`, and at least one connection needs a valid server-side credential,
tool-capable model, and both price fields. Start with `allowMutations: false`.
`allowedClusters` and `allowedTools` can narrow policy globally and again per
connection; `allowedTools` applies to evidence-gathering tools, while operation
types remain controlled by the built-in operation allowlist. These settings do
not grant Kafka permissions or expand the signed-in user's role and cluster
access.

When `allowMutations: true`, the engine still requires an `editor` or `admin`,
checks server/cluster `readOnly`, binds execution to the reviewed preview, and
verifies and audits the outcome. Agent operations cover a smaller allowlist
than the full management UI. Current agent run admission and recovery require a
single k-shui application worker/process even if the database is external.

## Generate a starter file

```bash
k-shui init                 # writes an annotated k-shui.yaml to the current directory
k-shui init -o /etc/k-shui/config.yaml --force
```

## Full reference

Every field, type, default and env-var name — including `auth.users[]`,
`auth.oidc`, and all per-integration sub-objects — is documented in
[**`deployment/configuration-reference.md`**](deployment/configuration-reference.md),
generated from `backend/k_shui/config.py`, the single source of truth. The
top-level schema is also summarized in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
