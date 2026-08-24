# Configuration Reference

k-shui is configured by a YAML file plus environment variable overrides. This
page is generated from `backend/k_shui/config.py` (the single source of truth
— regenerate/update this file whenever that module changes) and mirrors the
schema summarized in `../../ARCHITECTURE.md`.

## Loading order

1. `--config PATH` CLI flag
2. `$KSHUI_CONFIG` environment variable
3. `./k-shui.yaml`
4. `./k-shui.yml`
5. `~/.config/k-shui/config.yaml`
6. `/etc/k-shui/config.yaml`

The first file found is loaded (`k_shui.config.find_config_path`). If none is
found, k-shui starts with **zero** clusters configured in the file and
synthesizes a single cluster:

- `id: default`, `name: default`, `bootstrapServers: $KSHUI_BOOTSTRAP_SERVERS`
  (default `localhost:9092`).

`auth.jwtSecret`, if not set in the file, is taken from `$KSHUI_JWT_SECRET`, or
otherwise a random 32-byte hex value generated at process startup (**not**
persisted — sessions won't survive a restart unless you set this explicitly in
a multi-replica or restart-prone deployment).

String values inside the YAML file support `${VAR}` and `${VAR:-default}`
expansion from the process environment (`k_shui.config._expand_env`) — use
this to keep secrets out of the file/ConfigMap and inject them via env vars
instead (see `kubernetes-helm.md` / `security-hardening.md`).

## Environment variable overrides

Any scalar field below can be overridden with `KSHUI__<SECTION>__<KEY>`
(double underscore separator, case-insensitive), e.g. `KSHUI__SERVER__PORT=9000`,
`KSHUI__AUTH__TYPE=basic`, `KSHUI__DATABASE__URL=postgresql+asyncpg://...`.
List/nested-object fields (`clusters`, `auth.users`, `auth.oidc`, ...) are
practically YAML-only — there's no supported env-var shape for them.

Two extra, top-level (non-`KSHUI__`) env vars:

| Variable                  | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `KSHUI_CONFIG`            | Path to the config file (see loading order above).                                                 |
| `KSHUI_BOOTSTRAP_SERVERS` | Default cluster's `bootstrapServers` when no `clusters:` are configured. Default `localhost:9092`. |
| `KSHUI_JWT_SECRET`        | Stable JWT signing secret; generated randomly per-process if unset.                                |

## `server`

| Field      | Type     | Default   | Env var                   |
| ---------- | -------- | --------- | ------------------------- |
| `host`     | string   | `0.0.0.0` | `KSHUI__SERVER__HOST`     |
| `port`     | int      | `8090`    | `KSHUI__SERVER__PORT`     |
| `basePath` | string   | `/`       | `KSHUI__SERVER__BASEPATH` |
| `cors`     | string[] | `[]`      | — (YAML only)             |
| `readOnly` | bool     | `false`   | `KSHUI__SERVER__READONLY` |

## `auth`

| Field          | Type                             | Default                              | Env var                                          |
| -------------- | -------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `type`         | `none` \| `basic` \| `oidc`      | `none`                               | `KSHUI__AUTH__TYPE`                              |
| `users`        | `BasicAuthUser[]` (see below)    | `[]`                                 | — (YAML only)                                    |
| `oidc`         | `OIDCConfig` \| null (see below) | `null`                               | — (YAML only)                                    |
| `jwtSecret`    | string \| null                   | `null` (random per-process if unset) | `KSHUI__AUTH__JWTSECRET` (or `KSHUI_JWT_SECRET`) |
| `sessionHours` | int                              | `12`                                 | `KSHUI__AUTH__SESSIONHOURS`                      |

### `auth.users[]` (`BasicAuthUser`, used when `auth.type: basic`)

| Field      | Type                            | Default                                                          |
| ---------- | ------------------------------- | ---------------------------------------------------------------- |
| `username` | string                          | required                                                         |
| `password` | string                          | required (argon2 hash recommended; plaintext only for local dev) |
| `role`     | `admin` \| `editor` \| `viewer` | `viewer`                                                         |
| `clusters` | string[] \| null                | `null` (null = all clusters)                                     |

### `auth.oidc` (`OIDCConfig`, used when `auth.type: oidc`)

| Field          | Type                                      | Default                    |
| -------------- | ----------------------------------------- | -------------------------- |
| `issuer`       | string                                    | required                   |
| `clientId`     | string                                    | required                   |
| `clientSecret` | string                                    | required                   |
| `scopes`       | string[]                                  | `[openid, profile, email]` |
| `rolesClaim`   | string                                    | `roles`                    |
| `adminRoles`   | string[]                                  | `[admin]`                  |
| `editorRoles`  | string[]                                  | `[editor]`                 |
| `defaultRole`  | `admin` \| `editor` \| `viewer` \| `none` | `viewer`                   |

## `database`

| Field | Type                          | Default                           | Env var                |
| ----- | ----------------------------- | --------------------------------- | ---------------------- |
| `url` | string (SQLAlchemy async URL) | `sqlite+aiosqlite:///./k-shui.db` | `KSHUI__DATABASE__URL` |

`postgresql+asyncpg://...` is supported when the backend is installed with the
`postgres` extra (`pip install "k-shui[postgres]"` / `uv sync --extra postgres`).

## `telemetry`

| Field          | Type                | Default   | Env var                          |
| -------------- | ------------------- | --------- | -------------------------------- |
| `metrics`      | bool                | `true`    | `KSHUI__TELEMETRY__METRICS`      |
| `otlpEndpoint` | string \| null      | `null`    | `KSHUI__TELEMETRY__OTLPENDPOINT` |
| `logFormat`    | `json` \| `console` | `console` | `KSHUI__TELEMETRY__LOGFORMAT`    |
| `logLevel`     | string              | `INFO`    | `KSHUI__TELEMETRY__LOGLEVEL`     |

`metrics: true` exposes `GET /metrics` (Prometheus text format, root-level,
not under `/api/v1`). Setting `otlpEndpoint` requires the backend's `otel`
extra.

## `alerts`

| Field                       | Type                                                                 | Default | Env var                                    |
| --------------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------ |
| `evaluationIntervalSeconds` | int                                                                  | `30`    | `KSHUI__ALERTS__EVALUATIONINTERVALSECONDS` |
| `historyRetentionDays`      | int                                                                  | `30`    | `KSHUI__ALERTS__HISTORYRETENTIONDAYS`      |
| `smtp`                      | dict \| null (`host`, `port`, `username`, `password`, `from`, `tls`) | `null`  | — (YAML only)                              |

## `clusters[]` (`ClusterConfig`)

| Field                 | Type                                                                          | Default                                                            |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `id`                  | string (url-safe, unique)                                                     | required                                                           |
| `name`                | string \| null                                                                | defaults to `id`                                                   |
| `bootstrapServers`    | string                                                                        | required                                                           |
| `properties`          | dict (raw librdkafka properties: `security.protocol`, `sasl.*`, `ssl.*`, ...) | `{}`                                                               |
| `readOnly`            | bool                                                                          | `false`                                                            |
| `schemaRegistry`      | `SchemaRegistryConfig` \| null                                                | `null`                                                             |
| `connect`             | `ConnectClusterConfig[]`                                                      | `[]`                                                               |
| `ksqldb`              | `KsqlConfig[]`                                                                | `[]`                                                               |
| `flink`               | `FlinkConfig[]`                                                               | `[]`                                                               |
| `prometheus`          | `PrometheusConfig` \| null                                                    | `null`                                                             |
| `lineage`             | `LineageConfig` \| null                                                       | `null`                                                             |
| `metricsMode`         | `prometheus` \| `sampled`                                                     | `sampled` (auto-switches to `prometheus` once `prometheus` is set) |
| `pollIntervalSeconds` | int                                                                           | `15`                                                               |

`clusters` is a list, so it has no `KSHUI__` env-var form — configure it via
YAML.

### `clusters[].schemaRegistry` (`SchemaRegistryConfig`)

| Field                    | Type                                    | Default     |
| ------------------------ | --------------------------------------- | ----------- |
| `url`                    | string                                  | required    |
| `type`                   | `confluent` \| `apicurio` \| `karapace` | `confluent` |
| `auth`                   | `HttpAuth` \| null (see below)          | `null`      |
| `keySubjectNameStrategy` | `topic` \| `record` \| `topicRecord`    | `topic`     |

### `clusters[].connect[]` (`ConnectClusterConfig`)

| Field  | Type               | Default  |
| ------ | ------------------ | -------- |
| `name` | string             | required |
| `url`  | string             | required |
| `auth` | `HttpAuth` \| null | `null`   |

### `clusters[].ksqldb[]` (`KsqlConfig`)

| Field  | Type               | Default  |
| ------ | ------------------ | -------- |
| `name` | string             | required |
| `url`  | string             | required |
| `auth` | `HttpAuth` \| null | `null`   |

### `clusters[].flink[]` (`FlinkConfig`)

| Field           | Type               | Default  |
| --------------- | ------------------ | -------- |
| `name`          | string             | required |
| `url`           | string             | required |
| `sqlGatewayUrl` | string \| null     | `null`   |
| `auth`          | `HttpAuth` \| null | `null`   |

### `clusters[].prometheus` (`PrometheusConfig`)

| Field    | Type                                         | Default  |
| -------- | -------------------------------------------- | -------- |
| `url`    | string                                       | required |
| `labels` | dict[str,str] (extra PromQL label selectors) | `{}`     |
| `auth`   | `HttpAuth` \| null                           | `null`   |

### `clusters[].lineage` (`LineageConfig`)

| Field        | Type                | Default   |
| ------------ | ------------------- | --------- |
| `type`       | `marquez` \| `none` | `marquez` |
| `url`        | string \| null      | `null`    |
| `namespaces` | string[]            | `[]`      |
| `auth`       | `HttpAuth` \| null  | `null`    |

### `HttpAuth` (shared by schemaRegistry/connect/ksqldb/flink/prometheus/lineage)

| Field         | Type           | Default |
| ------------- | -------------- | ------- |
| `username`    | string \| null | `null`  |
| `password`    | string \| null | `null`  |
| `bearerToken` | string \| null | `null`  |

## Example

```yaml
server:
  host: 0.0.0.0
  port: 8090
  basePath: /
auth:
  type: none
database:
  url: sqlite+aiosqlite:///./k-shui.db
telemetry:
  metrics: true
alerts:
  evaluationIntervalSeconds: 30
clusters:
  - id: local
    name: lakestream (kind)
    bootstrapServers: localhost:9094
    schemaRegistry:
      url: http://localhost:8084/apis/ccompat/v7
      type: apicurio
    connect:
      - name: lakestream-connect
        url: http://localhost:8083
    flink:
      - name: lakestream-session
        url: http://localhost:8081
    prometheus:
      url: http://localhost:9090
    lineage:
      type: marquez
      url: http://localhost:3001/api/v1
```

See `../../deploy/examples/k-shui.local.yaml` for the canonical version of this
example, `deploy/compose/k-shui.yaml` for the docker-compose variant, and
`charts/k-shui/values-lakestream.yaml` for a Kubernetes/Strimzi variant with
OIDC auth and Secret-backed credentials.
