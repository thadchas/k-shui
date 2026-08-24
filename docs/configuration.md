# Configuration

k-shui is configured with a single YAML file (`k-shui.yaml` by default),
overridable per-field with `KSHUI__<SECTION>__<KEY>` environment variables.
This page is a two-minute orientation — the full field-by-field reference
(types, defaults, env var names) lives in
[`deployment/configuration-reference.md`](deployment/configuration-reference.md).

## The shape of it

```yaml
server:      { host, port, basePath, cors, readOnly }
auth:        { type: none|basic|oidc, users: [...], oidc: {...}, sessionHours }
database:    { url }                       # sqlite+aiosqlite:// (default) or postgresql+asyncpg://
telemetry:   { metrics, otlpEndpoint, logFormat, logLevel }
alerts:      { evaluationIntervalSeconds, historyRetentionDays, smtp }
clusters:
  - id: prod
    bootstrapServers: kafka-0:9092
    properties: {}                         # security.protocol, sasl.*, ssl.* — raw librdkafka
    schemaRegistry: { url, type: confluent|apicurio|karapace }
    connect: [{ name, url }]
    ksqldb: [{ name, url }]
    flink: [{ name, url, sqlGatewayUrl }]
    prometheus: { url, labels }
    lineage: { type: marquez|none, url, namespaces }
    metricsMode: sampled                   # auto-switches to prometheus once prometheus: is set
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
