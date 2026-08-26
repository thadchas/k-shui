# k-shui — Kafka Streaming Hub UI

Open-source, Apache-2.0 licensed control center for Apache Kafka® and its
streaming ecosystem. One UI that replaces Confluent Control Center and unifies
Kafbat UI, Flink UI, Kafka Connect, Schema Registry (Confluent / Apicurio),
Prometheus/Grafana dashboards and OpenLineage/Marquez stream lineage.

Deployable as: `uvx k-shui`, `npx k-shui`, Docker image, docker compose, Helm
chart / Kustomize on Kubernetes (CNCF-aligned: health probes, OTel traces,
Prometheus metrics, 12-factor config, SBOM, non-root distroless image).

## Repository layout (fixed — every agent must respect it)

```
k-shui/
├── ARCHITECTURE.md          this file: contracts every agent codes against
├── DESIGN.md                design system (tokens, components, layout rules)
├── README.md
├── backend/                 Python 3.11+ package `k_shui` (FastAPI)
│   ├── pyproject.toml       uv-managed; entry point `k-shui`
│   ├── k_shui/
│   │   ├── __init__.py      __version__
│   │   ├── main.py          create_app(), lifespan, static SPA serving
│   │   ├── cli.py           `k-shui serve|init|check|version` (typer)
│   │   ├── config.py        Settings + cluster config models (YAML + env)
│   │   ├── core/            registry.py (ClusterRegistry), errors.py, deps.py,
│   │   │                    auth.py (users/roles/JWT/OIDC), audit.py, events.py (SSE bus)
│   │   ├── db/              SQLAlchemy 2 async + aiosqlite (default) / postgres; models.py, session.py
│   │   ├── kafka/           admin.py, consumer.py (message browsing), producer.py,
│   │   │                    serdes/ (string,json,avro,protobuf,jsonschema via registry)
│   │   ├── integrations/    schema_registry.py, connect.py, ksql.py, flink.py,
│   │   │                    prometheus.py, lineage.py (marquez + derived), alerts/ (engine, notifiers)
│   │   ├── api/
│   │   │   ├── __init__.py  ROUTER_MODULES list; routers auto-imported (missing modules skipped)
│   │   │   └── routers/     clusters.py brokers.py topics.py messages.py consumer_groups.py
│   │   │                    acls.py quotas.py kraft.py schemas.py connect.py ksql.py flink.py
│   │   │                    metrics.py lineage.py alerts.py auth.py audit.py system.py events.py
│   │   └── static/          built frontend (copied by build); gitignored
│   └── tests/               pytest (+ pytest-asyncio, httpx AsyncClient, testcontainers optional)
├── frontend/                Vite + React 19 + TypeScript + Tailwind v4
│   ├── src/
│   │   ├── api/             client.ts (fetch/SSE wrapper), types.ts (mirrors this contract), hooks/ (TanStack Query)
│   │   ├── components/ui/   design-system primitives (shadcn-style, Radix)
│   │   ├── components/      shared app components (DataTable, StatCard, TimeSeriesChart, JsonViewer, CodeEditor, EmptyState …)
│   │   ├── layouts/         AppShell (sidebar + topbar + cluster switcher + command palette)
│   │   ├── pages/           one folder per feature area
│   │   ├── lib/             utils, formatters (bytes, numbers, durations), theme
│   │   └── routes.tsx       react-router v7 route tree
│   └── package.json
├── packages/npm/            `npx k-shui` wrapper (Node CLI: uses uv/uvx or docker; downloads uv if missing)
├── deploy/
│   ├── docker/Dockerfile    multi-stage (node build → python runtime, non-root, distroless-ish)
│   ├── compose/             docker-compose.yml (k-shui + Kafka KRaft + Connect + Apicurio + Flink + Prometheus + Marquez)
│   ├── kustomize/           base + overlays (dev, prod)
│   └── examples/            k-shui.yaml samples (local lakestream cluster, multi-cluster, SASL/TLS)
├── charts/k-shui/           Helm chart (ServiceMonitor, HPA, PDB, NetworkPolicy, Ingress, OIDC secrets)
├── docs/                    user docs (getting-started, configuration, features/*, deployment/*, api)
└── .github/workflows/       ci.yml (lint+test+build), release.yml (PyPI, npm, GHCR image, chart OCI)
```

## Configuration (YAML `k-shui.yaml`, overridable by env `KSHUI__<SECTION>__<KEY>`)

```yaml
server:
  host: 0.0.0.0
  port: 8090 # default
  basePath: / # for ingress sub-path
  cors: [] # extra origins
auth:
  type: none # none | basic | oidc
  users: # for basic
    - username: admin
      password: "$argon2..." # or plaintext for dev
      role: admin # admin | editor | viewer
  oidc:
    {
      issuer,
      clientId,
      clientSecret,
      scopes: [openid, profile, email],
      rolesClaim: roles,
    }
database:
  url: sqlite+aiosqlite:///./k-shui.db # or postgresql+asyncpg://...
telemetry:
  metrics: true # /metrics prometheus
  otlpEndpoint: null # OpenTelemetry traces
alerts:
  evaluationIntervalSeconds: 30
clusters:
  - id: local # url-safe, unique
    name: lakestream (kind)
    bootstrapServers: localhost:9094
    properties: {} # raw librdkafka props (security.protocol, sasl.*, ssl.*)
    schemaRegistry:
      url: http://localhost:8084/apis/ccompat/v7 # Confluent-compatible API (Apicurio ccompat or Confluent SR)
      type: apicurio # confluent | apicurio | karapace
      auth: { username, password }
    connect:
      - name: lakestream-connect
        url: http://localhost:8083
    ksqldb:
      - name: ksql
        url: http://localhost:8088
    flink:
      - name: lakestream-session
        url: http://localhost:8081
        sqlGatewayUrl: null
    prometheus:
      url: http://localhost:9090
      labels: { cluster: lakestream } # label selectors added to every PromQL
    lineage:
      type: marquez
      url: http://localhost:3001/api/v1
      namespaces: []
    metricsMode: prometheus # prometheus | jmx-off (fallback to admin API sampled metrics)
```

Backend `Settings` (pydantic-settings) loads YAML from `--config`, `KSHUI_CONFIG`, `./k-shui.yaml`,
`~/.config/k-shui/config.yaml` (first found). With no config at all it starts with a single
cluster from `KSHUI_BOOTSTRAP_SERVERS` (default `localhost:9092`).

## REST API contract (`/api/v1`, JSON, camelCase fields, RFC 9457 problem+json errors)

Common: pagination `?page=1&perPage=50` → `{items, page, perPage, total}`. Time ranges
`?range=1h|6h|24h|7d` or `?start=&end=&step=`. Time series: `{series:[{name, labels, points:[[tsMs, value]]}]}`.
Every mutating call is audited. Every route is prefixed with `/api/v1`.

**Roles (enforced on every router when `auth` is enabled):** `GET` routes require `viewer`;
`POST|PUT|PATCH|DELETE` require `editor`; user management requires `admin`. The only
editor-exempt mutations are `POST .../ksql/{k}/query` (a streaming read) and
`POST .../ksql/{k}/close-query` (closes the caller's own push query). `POST .../lineage/openlineage`
(ingest) is an editor mutation. Server/cluster `readOnly` blocks editors too.

### System

- `GET /info` → `{version, uptimeSeconds, auth:{type, enabled}, features:{...}, clusters:[{id,name}]}`
- `GET /healthz`, `GET /readyz` (root-level, not under /api), `GET /metrics` (root-level, Prometheus)
- `GET /events` → SSE stream of `{type, clusterId, ts, payload}` (alert.fired, alert.resolved, topic.created, connector.failed, …)
- `GET /auth/me`, `POST /auth/login {username,password}` → `{token, user}`, `POST /auth/logout`, `GET /auth/oidc/login`, `GET /auth/oidc/callback`
- `GET /audit?page&perPage&clusterId&user&action` → `{items:[{id, ts, user, action, resource, clusterId, details, ip}]}`

### Clusters

- `GET /clusters` → `[{id, name, status:'online'|'degraded'|'offline', version, controllerId, brokerCount, onlineBrokers, topicCount, partitionCount, underReplicatedPartitions, offlinePartitions, inSyncReplicasPct, bytesInPerSec, bytesOutPerSec, features:{schemaRegistry,connect,ksqldb,flink,prometheus,lineage}}]`
- `GET /clusters/{c}` → same plus `{clusterId (kafka), listeners, kraft:{leaderId, epoch, voters, observers}}`
- `GET /clusters/{c}/health` → `{status, checks:[{name, status, message}]}`
- `GET /clusters/{c}/partitions/unhealthy` → `{items:[{topic, partition, leader, replicas, isr, reasons:['offline'|'underReplicated'|'nonPreferredLeader']}], offline, underReplicated, nonPreferredLeader, scannedPartitions}` (worst first)
- `GET /clusters/{c}/partitions/capabilities` → `{clientVersion, electLeaders, reassign, listReassignments}` (feature-detected on the Kafka client)
- `POST /clusters/{c}/partitions/elect-leaders {partitions:[{topic,partition}], electionType:'preferred'|'unclean'}` (empty = all) → `{electionType, items:[{topic, partition, status:'elected'|'notNeeded'|'failed', error?}], succeeded, failed, notNeeded}` — audited `partitions.elect_leaders`
- `GET /clusters/{c}/partitions/reassignments` → `{supported, reason?, items:[{topic, partition, replicas, addingReplicas, removingReplicas}]}`
- `POST /clusters/{c}/partitions/reassign/plan {topics:[…], brokers?:[…]}` → `{items:[{topic, partition, current, proposed, changed}], reassignmentJson, command}` — rack-aware balanced plan, RF preserved, never applies (viewer)
- `POST /clusters/{c}/partitions/reassign {partitions:[{topic, partition, replicas:[…]}], throttleBytesPerSec?}` → `202 {…}` — audited `partitions.reassign`; when the client lacks `alter_partition_reassignments` → `501 unsupported-feature` problem carrying `reassignmentJson` + a `kafka-reassign-partitions.sh` `command` for manual execution
- `GET /clusters/{c}/overview/metrics?range=` → series: bytesIn, bytesOut, messagesIn, requestRate, activeControllers, underReplicated, offlinePartitions (Prometheus when configured, else sampled from admin API into in-memory ring buffer)

### Brokers

- `GET /clusters/{c}/brokers` → `[{id, host, port, rack, isController, partitionCount, leaderCount, underReplicatedPartitions, logDirSizeBytes, logDirTotalBytes?, logDirUsableBytes?, status:'online'|'offline', version}]` (capacity fields are null unless the client supports `describe_log_dirs`)
- `GET /clusters/{c}/brokers/{b}` , `GET .../configs` → `[{name, value, source, isDefault, isReadOnly, isSensitive, documentation}]`, `PUT .../configs {configs:{k:v}}`
- `GET .../logdirs` → `[{path, sizeBytes, totalBytes?, usableBytes?, error?, partitions:[{topic, partition, sizeBytes, offsetLag}]}]`
- `GET .../metrics?range=` → series: bytesIn, bytesOut, requestHandlerIdle, networkProcessorIdle, produceLatencyP99, fetchLatencyP99, jvmHeapUsed, gcTime

### Topics

- `GET /clusters/{c}/topics?search&showInternal&page&perPage&sort&order` → items `{name, partitions, replicationFactor, isInternal, underReplicatedPartitions, sizeBytes, messageCount (endOffset−beginOffset sum), cleanupPolicy, retentionMs, hasSchema:{key,value}, bytesInPerSec, bytesOutPerSec}`
- `POST /clusters/{c}/topics {name, partitions, replicationFactor, configs:{}}`
- `GET /clusters/{c}/topics/{t}` → detail `{…list fields, partitionsDetail:[{id, leader, replicas:[], isr:[], beginOffset, endOffset, sizeBytes}], configs summary}`
- `DELETE /clusters/{c}/topics/{t}`
- `GET|PUT /clusters/{c}/topics/{t}/configs` (same shape as broker configs; PUT does incremental alter)
- `POST /clusters/{c}/topics/{t}/partitions {count}`
- `POST /clusters/{c}/topics/{t}/purge {partitions?:[{id, beforeOffset}]}` (deleteRecords; default all to end)
- `POST /clusters/{c}/topics/{t}/clone {name}` (config copy)
- `GET /clusters/{c}/topics/{t}/consumers` → `[{groupId, state, lag, members}]`
- `GET /clusters/{c}/topics/{t}/metrics?range=` → series messagesIn, bytesIn, bytesOut, size
- `GET /clusters/{c}/topics/{t}/schema` → `{key:{subject,version,schemaId,type}|null, value:{…}|null, strategy}`
- `GET /clusters/{c}/topics/{t}/messages?mode=latest|earliest|offset|timestamp|tail&partitions=0,1&offset=&startOffsets=0:120,3:7&timestamp=&limit=100&keyFormat=auto&valueFormat=auto&filter=&filterMode=contains|jsonpath|regex&filterTarget=any|key|value|header&stream=true`
  → SSE events `message` (one `Message` each), `progress {scanned, matched, done}`, `end`; `stream=false` returns `{items, scanned}`
  - `startOffsets` (only with `mode=offset`) overrides the scalar `offset` per partition; partitions not listed use `offset`; neither given → `400`.
  - `mode=tail` follows the partitions from their end (or the given offsets) until the client disconnects: never sends `end`; emits `progress {scanned, matched, done:false, live:true, behind, endOffsets:{p:o}, positions:{p:o}}` every ~2 s as a heartbeat; batches are flushed at most every 100 ms; `stream=false` and `/export` reject `tail` with `400`.
  - `filterTarget` scopes `contains|regex|jsonpath` to the key, the decoded value, or the headers. A filter of the form `header:<name>=<value>` matches by header name (value = substring or regex per `filterMode`); `header:<name>` alone tests presence.
    `Message = {partition, offset, timestamp, timestampType, key, keyFormat, value, valueFormat, headers:{k:v}, keySchemaId, valueSchemaId, sizeBytes, keyRaw?, valueRaw?}`
    Formats: `auto|string|json|avro|protobuf|jsonschema|base64|hex|int|long`. Auto = magic-byte 0 → registry; else json if parseable; else string.
- `POST /clusters/{c}/topics/{t}/messages {partition?, key?, value, headers?, keyFormat, valueFormat, keySchemaSubject?, valueSchemaSubject?}` → `{partition, offset}`
- `GET /clusters/{c}/topics/{t}/messages/export?format=json|csv|ndjson&…same filters` → file download

### Consumer groups & share groups

- `GET /clusters/{c}/consumer-groups?search&state&page&perPage&sort&order` → `[{groupId, groupType:'classic'|'consumer'|'share', state, protocolType, protocol, coordinatorId, memberCount, topicCount, partitionCount, totalLag, maxTimeLagMs, isSimple}]`; when `page` is passed the response is the `{items, total, page, perPage}` envelope (sorted before slicing) — the bare list is kept for callers that omit `page`
- `GET /clusters/{c}/consumer-groups/{g}` → `{…, members:[{memberId, clientId, host, assignments:[{topic,partition}]}], partitions:[{topic, partition, currentOffset, endOffset, lag, timeLagMs, memberId, clientId, host}], topicsSummary:[{topic, lag, partitions}]}` — `timeLagMs = lag ÷ (topic produce rate ÷ partition count)` from the metrics sampler's last two samples; `null` when the rate is unknown or the topic is idle (never a misleading 0)
- `DELETE /clusters/{c}/consumer-groups/{g}`
- `POST /clusters/{c}/consumer-groups/{g}/offsets/reset {topic?, partitions?:[], strategy:'earliest'|'latest'|'offset'|'timestamp'|'shiftBy', value?, dryRun?}` → `[{topic, partition, oldOffset, newOffset}]`; `partitions` scoping is preserved even when the group has no commits for that topic (`404` if none of the requested partitions exist)
- `DELETE /clusters/{c}/consumer-groups/{g}/offsets {topic}`
- `GET /clusters/{c}/consumer-groups/{g}/lag-history?range=` → series per topic
- `GET /clusters/{c}/consumer-groups/export.csv`
- `GET /clusters/{c}/share-groups` (Kafka 4.x; `{supported:false}` when unavailable)

### Security & cluster settings

- `GET /clusters/{c}/acls?resourceType&resourceName&principal`, `POST /clusters/{c}/acls {resourceType, resourceName, patternType, principal, host, operation, permissionType}`, `DELETE` with same filter
- `GET|PUT|DELETE /clusters/{c}/quotas` `{entityType:'user'|'client-id'|'ip', entityName, quotas:{producer_byte_rate, consumer_byte_rate, request_percentage}}`
- `GET /clusters/{c}/kraft/quorum` → `{leaderId, leaderEpoch, highWatermark, voters:[{id, logEndOffset, lastFetchTs, lastCaughtUpTs, lag}], observers:[…]}`
- `GET|POST|DELETE /clusters/{c}/scram-users`
- `GET /clusters/{c}/configs` (cluster-level dynamic configs) / `PUT`
- `GET /clusters/{c}/replication` → MirrorMaker2/replicator connectors detected in Connect (source→target topics, lag)

### Schema registry

- `GET /clusters/{c}/schemas/subjects?search&deleted` → `[{subject, latestVersion, schemaType:'AVRO'|'PROTOBUF'|'JSON', compatibility, versionsCount, topic?}]`
- `GET /clusters/{c}/schemas/subjects/{s}?deleted` → `{subject, compatibility, versions:[{version, id, schemaType, schema, references, deleted, createdAt?}]}` — `deleted=true` includes soft-deleted versions (flag derived from the live vs. full version lists when the registry omits it); a subject whose versions are all soft-deleted returns `404` with guidance to delete permanently
- `GET /clusters/{c}/schemas/subjects/{s}/versions/{v}`; `POST /clusters/{c}/schemas/subjects/{s}/versions {schema, schemaType, references, normalize}`
- `DELETE /clusters/{c}/schemas/subjects/{s}?permanent`, `DELETE .../versions/{v}?permanent` (soft delete first, then permanent, per registry semantics)
- `GET|PUT|DELETE /clusters/{c}/schemas/subjects/{s}/config` `{compatibility}` (`DELETE` removes the override → `{…global, explicit:false}`); `GET|PUT /clusters/{c}/schemas/config` (global)
- `POST /clusters/{c}/schemas/subjects/{s}/compatibility {schema, schemaType, references?, normalize?}` → `{isCompatible, messages}`
- `GET /clusters/{c}/schemas/subjects/{s}/diff?from=&to=` → `{from, to, unifiedDiff}`
- `GET /clusters/{c}/schemas/ids/{id}`; `GET /clusters/{c}/schemas/info` → `{type, url, mode, version}`

### Kafka Connect

- `GET /clusters/{c}/connect` → `[{name, url, version, commit, kafkaClusterId, status:'online'|'offline', connectorCount, runningTasks, failedTasks}]`
- `GET /clusters/{c}/connect/{k}/connectors?search&state&type` → `[{name, type:'source'|'sink', connectorClass, state, workerId, tasks:[{id, state, workerId, trace}], topics:[], config}]`
- `POST /clusters/{c}/connect/{k}/connectors {name, config}`; `GET|PUT .../connectors/{n}/config`; `GET .../connectors/{n}` (info+status+topics); `DELETE`
- `POST .../connectors/{n}/pause|resume|stop|restart?includeTasks&onlyFailed`; `POST .../connectors/{n}/tasks/{id}/restart`
- `GET .../connectors/{n}/topics`, `PUT .../connectors/{n}/topics/reset`
- `GET|PATCH|DELETE .../connectors/{n}/offsets`
- `GET .../plugins` → `[{class, type, version}]`; `PUT .../plugins/{class}/validate {config}` → `{name, errorCount, groups, configs:[{definition:{name,type,required,defaultValue,importance,documentation,group,dependents}, value:{value, recommendedValues, errors, visible}}]}`
- `GET .../metrics?range=` (Prometheus)

### ksqlDB

- `GET /clusters/{c}/ksql` → `[{name, url, version, serverStatus, ksqlServiceId}]`
- `POST /clusters/{c}/ksql/{k}/query {sql, properties}` → SSE: `header {columnNames, columnTypes, queryId}`, `row {values}`, `error`, `end`
- `POST /clusters/{c}/ksql/{k}/statement {sql, properties}` → ksql /ksql response array (editor)
- `POST /clusters/{c}/ksql/{k}/close-query {queryId}` → closes a transient push query (viewer)
- `GET .../streams`, `GET .../tables`, `GET .../queries`, `DELETE .../queries/{id}` (TERMINATE), `GET .../streams/{name}` (DESCRIBE EXTENDED)
- `GET /clusters/{c}/ksql/{k}/history` (saved & recent statements per user, SQLite)

### Flink

- `GET /clusters/{c}/flink` → `[{name, url, version, status, taskmanagers, slotsTotal, slotsAvailable, jobsRunning, jobsFinished, jobsCancelled, jobsFailed}]`
- `GET /clusters/{c}/flink/{f}/overview`, `GET .../config`
- `GET .../jobs` → `[{jid, name, state, startTime, endTime, duration, tasks:{total, running, finished, canceling, canceled, failed, created, scheduled, deploying, reconciling, initializing}}]`
- `GET .../jobs/{jid}` → detail + `vertices[]` + `plan`; `GET .../jobs/{jid}/checkpoints`, `.../checkpoints/config`, `.../exceptions`, `.../metrics?get=`, `.../vertices/{v}/subtasks`, `.../vertices/{v}/backpressure`, `.../vertices/{v}/watermarks`
- `PATCH .../jobs/{jid}?mode=cancel|stop` (cancel), `POST .../jobs/{jid}/savepoints {targetDirectory, cancelJob}` → trigger id; `GET .../jobs/{jid}/savepoints/{triggerId}`
- `GET .../taskmanagers`, `GET .../taskmanagers/{id}`, `.../taskmanagers/{id}/logs`, `.../taskmanagers/{id}/metrics`, `GET .../jobmanager/logs`, `.../jobmanager/metrics`
- `GET .../jars`, `POST .../jars/upload` (multipart), `POST .../jars/{id}/run {entryClass, programArgs, parallelism, savepointPath}`, `DELETE .../jars/{id}`
- `POST .../sql/sessions`, `DELETE .../sql/sessions/{s}`, `POST .../sql/sessions/{s}/statements {statement}` → operationHandle, `GET .../sql/sessions/{s}/operations/{op}/result?token`, `DELETE .../sql/sessions/{s}/operations/{op}` (cancel + close → `{operationHandle, cancelled, closed, status}`) (Flink SQL Gateway proxy, `{supported:false}` when no gateway)

### Metrics (Prometheus-backed dashboards, Grafana-equivalent)

- `GET /clusters/{c}/metrics/status` → `{configured, url, reachable, buildInfo, targets:[{job, health, lastScrape}]}`
- `GET /clusters/{c}/metrics/query?query&time`, `GET /clusters/{c}/metrics/query_range?query&start&end&step` (Prometheus proxy, label selectors injected)
- `GET /clusters/{c}/metrics/catalog?search` → metric names + help
- `GET /clusters/{c}/metrics/dashboards` → built-in `[{id, title, description, tags, builtin:true}]` (cluster-overview, brokers, topics, consumer-lag, connect, flink, jvm, kraft) + user dashboards
- `GET /clusters/{c}/metrics/dashboards/{id}` → `{id, title, variables:[{name, query}], rows:[{title, panels:[{id, title, type:'timeseries'|'stat'|'gauge'|'table'|'bar'|'heatmap', unit, queries:[{expr, legend}], thresholds}]}]}`
- `POST|PUT|DELETE /metrics/dashboards` (user dashboards, SQLite; Grafana-JSON import supported: `POST /metrics/dashboards/import`)
- `GET /clusters/{c}/metrics/dashboards/{id}/data?range&step&vars` → evaluates all panels → `{panels:{[panelId]: {series}}}`

### Stream lineage

- `GET /clusters/{c}/lineage/graph?focus=<nodeId>&depth=3&sources=marquez,connect,flink,ksql,consumers` → `{nodes:[{id, type:'topic'|'connector'|'flinkJob'|'ksqlQuery'|'consumerGroup'|'producer'|'dataset'|'job'|'schema', label, namespace, status, meta, clusterId}], edges:[{id, source, target, kind:'produces'|'consumes'|'transforms', meta}]}`
  Built by merging Marquez (jobs/datasets/runs) with derived edges: Connect connector→topics (source) / topics→connector (sink), consumer groups→topics, ksql streams, Flink jobs (from Marquez or job name/vertex heuristics).
- `GET /clusters/{c}/lineage/nodes/{id}` → detail (`latestRuns`, schema, facets)
- `GET /clusters/{c}/lineage/search?q`, `GET /clusters/{c}/lineage/namespaces`, `GET /clusters/{c}/lineage/datasets?namespace`, `GET /clusters/{c}/lineage/jobs?namespace`, `GET /clusters/{c}/lineage/runs?jobId`
- `POST /lineage/openlineage` → OpenLineage event ingest (forwarded to Marquez if configured, else stored locally)

### Alerts (Control Center parity)

- Triggers: `GET|POST /alerts/triggers`, `GET|PUT|DELETE /alerts/triggers/{id}`, `POST /alerts/triggers/{id}/enable|disable`
  `Trigger = {id, name, clusterId, component:'cluster'|'broker'|'topic'|'consumerGroup'|'connector'|'ksqlQuery'|'flinkJob'|'schemaRegistry'|'custom', target:{name?, regex?}, metric, condition:'gt'|'gte'|'lt'|'lte'|'eq'|'ne', value, bufferSeconds, severity:'critical'|'warning'|'info', enabled, actionIds:[], createdAt, updatedAt}`
  Metric catalog `GET /alerts/metrics` → per component: cluster(underReplicatedPartitions, offlinePartitions, activeControllerCount, zkOrKraftUnavailable, brokerDownCount, bytesIn, bytesOut), broker(bytesIn, bytesOut, produceRequestLatency, fetchRequestLatency, diskUsagePct, isOffline), topic(underReplicated, bytesIn, bytesOut, messagesIn, sizeBytes), consumerGroup(lag, lagPerPartition, consumptionDifference, memberCount, isEmpty), connector(state!=RUNNING, failedTasks, taskState), ksqlQuery(errorRate, messagesConsumed), flinkJob(state!=RUNNING, restarts, checkpointFailures, backpressure), custom(promql expr)
- Actions: `GET|POST /alerts/actions`, `GET|PUT|DELETE /alerts/actions/{id}`, `POST /alerts/actions/{id}/test`
  `Action = {id, name, type:'email'|'slack'|'pagerduty'|'webhook'|'teams', config, enabled}` (email via SMTP settings, slack incoming webhook, pagerduty Events API v2 routing key, generic webhook w/ template)
- History: `GET /alerts/history?status=firing|resolved&component&clusterId&since&page` → `[{id, triggerId, triggerName, component, target, clusterId, severity, status, value, threshold, firedAt, resolvedAt, notifications:[{actionId, status, error}]}]`, `POST /alerts/history/{id}/ack`
- `GET /alerts/summary` → counts by severity/cluster for the topbar bell.
- Engine: APScheduler job every `evaluationIntervalSeconds` evaluates every enabled trigger against live data (admin API / Prometheus), applies `bufferSeconds` (condition must hold for that long), fires actions, records history, emits `alert.fired`/`alert.resolved` SSE events, exports `kshui_alerts_firing{severity}` gauge.

## Frontend routes (react-router v7)

```
/                                   → redirect to /clusters
/clusters                           cluster cards grid + health
/c/:cluster/overview                cluster overview (stat tiles + throughput charts + health checks + kraft quorum)
/c/:cluster/brokers                 /brokers/:id (tabs: overview, configs, log dirs, metrics)
/c/:cluster/topics                  /topics/new  /topics/:topic (tabs: overview, messages, partitions, configs, consumers, schema, metrics, lineage)
/c/:cluster/consumers               /consumers/:group (tabs: overview, partitions, members, lag chart)  + /share-groups
/c/:cluster/schemas                 /schemas/new  /schemas/:subject (versions, diff, compatibility)
/c/:cluster/connect                 /connect/:kc  /connect/:kc/connectors/new  /connect/:kc/connectors/:name (tabs: overview, config, tasks, topics, offsets)  /connect/:kc/plugins
/c/:cluster/ksql                    editor + streams/tables/queries tabs
/c/:cluster/flink                   /flink/:fc (overview) /flink/:fc/jobs/:jid (tabs: overview, graph, checkpoints, exceptions, metrics)  /flink/:fc/taskmanagers  /flink/:fc/sql  /flink/:fc/jars
/c/:cluster/replication             MirrorMaker2 / replicator view
/c/:cluster/metrics                 dashboards list  /metrics/:dashboard  /metrics/explore (PromQL explorer)
/c/:cluster/lineage                 graph canvas (React Flow) + side panel + search
/c/:cluster/security                tabs: acls, quotas, scram users
/c/:cluster/settings                cluster dynamic configs + kraft quorum
/alerts                             tabs: history, triggers, actions  (/alerts/triggers/new, /alerts/triggers/:id, /alerts/actions/new)
/audit                              audit log
/settings                           app settings, users (basic auth), about
/login
```

## Non-functional requirements

- Backend: type-annotated, `ruff` clean, tests for every router with a fake Kafka layer; graceful degradation when an integration is unconfigured/unreachable (`503 problem+json` with `type: ".../integration-unavailable"`), never crash the app.
- Frontend: strict TS, ESLint clean, `vite build` passes, every list virtualized/paginated, every page has loading skeletons + empty states + error states, keyboard command palette (⌘K), light/dark theme, responsive ≥ 1024px primary, usable at 768px.
- Security: no secrets in logs, sensitive configs masked, CSRF-safe token auth, CSP header, rate limit on login.
- Observability: structured JSON logs (structlog), `/metrics`, optional OTel.
