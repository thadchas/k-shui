# REST API

k-shui's primary workflow is the k-shui Agent in the visual workspace. Both
use the public REST API exposed by the k-shui engine, and the same direct API
remains available for expert automation. This page covers the conventions; the
field-level contract for every route lives in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md#rest-api-contract-apiv1-json-camelcase-fields-rfc-9457-problemjson-errors),
and an interactive, generated-from-code reference is served by the app itself.

## Base URL and versioning

Every route (except a handful of root-level ones) is under `/api/v1`, JSON
in/out, camelCase field names.

| Root-level (not under `/api/v1`)               | Purpose                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| `GET /healthz`                                 | Liveness probe                                      |
| `GET /readyz`                                  | Readiness probe                                     |
| `GET /metrics`                                 | k-shui's own Prometheus metrics                     |
| `GET /docs`, `GET /redoc`, `GET /openapi.json` | Interactive Swagger UI / ReDoc / raw OpenAPI schema |

## Interactive docs

Every k-shui instance serves a live, generated-from-code API explorer at
**`/docs`** (Swagger UI) and `/redoc` — that's the authoritative, always
up-to-date reference; this page is a curl-first orientation on top of it.

```bash
open http://localhost:8090/docs
```

## Auth

| `auth.type` | How to authenticate                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`      | No auth header needed                                                                                                                                                             |
| `basic`     | `POST /api/v1/auth/login {username, password}` → `{token, user}`; send the token as `Authorization: Bearer <token>` on subsequent requests                                        |
| `oidc`      | Browser redirect flow (`GET /api/v1/auth/oidc/login` → IdP → `GET /api/v1/auth/oidc/callback`); for scripting, obtain a token via your IdP and pass it the same way as basic auth |

```bash
TOKEN=$(curl -s -X POST http://localhost:8090/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

curl -s http://localhost:8090/api/v1/clusters \
  -H "Authorization: Bearer $TOKEN"
```

See [`features/auth-rbac.md`](features/auth-rbac.md) for roles and OIDC
config.

The Agent has a stricter authentication boundary than the rest of the API. It
is disabled by default, and every investigation, inspection, preview, or
execution requires an authenticated human user with current cluster access.
`auth.type: none` therefore leaves the Agent unavailable even though direct API
routes may be open. Operate mode additionally requires an editor, deployment
mutation enablement, and a writable server and cluster.

## Errors: RFC 9457 problem+json

Every error response is `application/problem+json`:

```json
{
  "type": "https://k-shui.dev/problems/integration-unavailable",
  "title": "Integration unavailable",
  "status": 503,
  "detail": "schema registry at http://schema-registry:8081 did not respond within 8s",
  "instance": "/api/v1/clusters/prod/schemas/subjects"
}
```

Common `type` suffixes: `not-found`, `conflict`, `bad-request`, `forbidden`,
`read-only`, `integration-unavailable` (integration configured but
unreachable — 503), `integration-not-configured` (no config for that
integration on this cluster — 404), `upstream-error` (502, the integration
responded with an error k-shui couldn't interpret).

## Pagination

List endpoints accept `?page=1&perPage=50` and return:

```json
{ "items": [...], "page": 1, "perPage": 50, "total": 137 }
```

## Time ranges and series

Metric endpoints accept `?range=1h|6h|24h|7d` or explicit `?start=&end=&step=`.
Series responses share one shape:

```json
{ "series": [ { "name": "bytesIn", "labels": {"broker": "1"}, "points": [[1735689600000, 4213.5], ...] } ] }
```

## Server-Sent Events (SSE)

Streaming endpoints (`GET /api/v1/events`, message-browser `stream=true`,
ksqlDB `POST .../query`) are `text/event-stream`. Each event has a `type`/
`event` name and a JSON `data` payload; a stream typically ends with an `end`
event.

```bash
curl -N http://localhost:8090/api/v1/events \
  -H "Authorization: Bearer $TOKEN"
# event: message
# data: {"type":"alert.fired","clusterId":"prod","ts":"...","payload":{...}}
```

```bash
# Live-tail a topic
curl -N "http://localhost:8090/api/v1/clusters/prod/topics/orders/messages?mode=latest&stream=true&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

## k-shui Agent API

The Agent routes support the visual investigation workspace. Provider
credentials and model selection are deployment-managed; clients cannot submit
provider URLs, credentials, tools, or an acting identity. Except for the status
probe, these routes enforce the Agent authentication boundary described above.

| Method         | Route                                                                | Purpose                                                                                       |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`          | `/api/v1/agent/status`                                               | Effective availability, modes, policy limits, and visible connections for the current session |
| `GET`          | `/api/v1/agent/connections`                                          | List permitted deployment-managed connections                                                 |
| `POST`         | `/api/v1/agent/connections/{connectionId}/test`                      | Administrator-only, rate-limited provider capability test                                     |
| `GET` / `POST` | `/api/v1/agent/investigations`                                       | List the initiating user's investigations or create one                                       |
| `GET`          | `/api/v1/agent/investigations/{id}`                                  | Investigation, evidence, findings, and operation state                                        |
| `POST`         | `/api/v1/agent/investigations/{id}/evidence/{evidenceId}/refresh`    | Append refreshed evidence under current authority; preserve earlier observations              |
| `POST`         | `/api/v1/agent/investigations/{id}/messages`                         | Add a question and start a bounded run (`202`)                                                |
| `GET`          | `/api/v1/agent/investigations/{id}/events`                           | Stream investigation snapshots over SSE                                                       |
| `POST`         | `/api/v1/agent/investigations/{id}/cancel`                           | Stop subsequent investigation work                                                            |
| `POST`         | `/api/v1/agent/investigations/{id}/operations/prepare`               | Prepare an exact supported operation; does not execute it                                     |
| `POST`         | `/api/v1/agent/investigations/{id}/operations/{operationId}/execute` | Execute a reviewed preview, with confirmation when required                                   |
| `POST`         | `/api/v1/agent/investigations/{id}/operations/{operationId}/cancel`  | Cancel a prepared operation before dispatch                                                   |

Investigations are fixed to one cluster and one connection and may optionally
carry resource and time-window context. Inspect mode exposes only bounded
metadata for cluster health, topics, consumer lag, connector tasks, Flink
checkpoints, lineage neighbors, schema summaries, alert evidence, and audit
headers. It does not expose messages, arbitrary URLs, SQL, logs, or shell tools.

The supported operation actions are `topic.create`, `topic.config.update`,
`topic.delete`, `topic.purge`, `topic.partitions.increase`, `connector.pause`,
`connector.resume`, `connector.restart`, `connector.task.restart`, and
`group.offsets.reset`. The engine limits targets and parameters, excludes
internal topics, requires a successful dry run for offset resets, expires
previews after five minutes, and rechecks authority and resource state before
dispatch. See [`k-shui-agent.md`](k-shui-agent.md) for the complete operational
and deployment boundaries.

## curl examples per area

```bash
# Clusters
curl -s $HOST/api/v1/clusters -H "$AUTH"

# Topics
curl -s "$HOST/api/v1/clusters/prod/topics?search=orders&perPage=20" -H "$AUTH"
curl -s -X POST "$HOST/api/v1/clusters/prod/topics" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"orders","partitions":6,"replicationFactor":3,"configs":{"cleanup.policy":"delete"}}'

# Messages: live tail with a header filter (SSE; Ctrl-C to stop)
curl -N "$HOST/api/v1/clusters/prod/topics/orders/messages?mode=tail&filter=header:trace=abc123" -H "$AUTH"

# Messages: seek partition 0 to 120 and partition 3 to 7, everything else from offset 0
curl -s "$HOST/api/v1/clusters/prod/topics/orders/messages?mode=offset&offset=0&startOffsets=0:120,3:7&stream=false" -H "$AUTH"

# Partitions: what is unhealthy, then elect preferred leaders for all of it
curl -s "$HOST/api/v1/clusters/prod/partitions/unhealthy" -H "$AUTH"
curl -s -X POST "$HOST/api/v1/clusters/prod/partitions/elect-leaders" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"partitions":[],"electionType":"preferred"}'

# Partitions: rack-aware rebalance plan (never applies)
curl -s -X POST "$HOST/api/v1/clusters/prod/partitions/reassign/plan" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"topics":["orders"]}'

# Consumer groups: dry-run an offset reset to earliest
curl -s -X POST "$HOST/api/v1/clusters/prod/consumer-groups/orders-service/offsets/reset" -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"topic":"orders","strategy":"earliest","dryRun":true}'

# Schema Registry: check compatibility before registering
curl -s -X POST "$HOST/api/v1/clusters/prod/schemas/subjects/orders-value/compatibility" -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"schema":"{...avro json...}","schemaType":"AVRO"}'

# Kafka Connect: pause a connector
curl -s -X POST "$HOST/api/v1/clusters/prod/connect/connect/connectors/s3-sink/pause" -H "$AUTH"

# ksqlDB: run a statement
curl -s -X POST "$HOST/api/v1/clusters/prod/ksql/ksql/statement" -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"sql":"SHOW STREAMS;","properties":{}}'

# Flink: cancel a job
curl -s -X PATCH "$HOST/api/v1/clusters/prod/flink/session/jobs/<jid>?mode=cancel" -H "$AUTH"

# Metrics: instant PromQL
curl -s "$HOST/api/v1/clusters/prod/metrics/query?query=up" -H "$AUTH"

# Lineage: graph around a topic
curl -s "$HOST/api/v1/clusters/prod/lineage/graph?focus=topic:orders&depth=2" -H "$AUTH"

# Alerts: create a lag trigger
curl -s -X POST "$HOST/api/v1/alerts/triggers" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"orders lag","clusterId":"prod","component":"consumerGroup","target":{"name":"orders-service"},"metric":"lag","condition":"gt","value":10000,"bufferSeconds":120,"severity":"warning","enabled":true,"actionIds":[]}'

# Audit
curl -s "$HOST/api/v1/audit?perPage=50" -H "$AUTH"
```

Full per-area endpoint tables (with request/response shapes) live alongside
each feature's docs in [`features/`](features/).
