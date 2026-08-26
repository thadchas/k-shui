# Changelog

All notable changes to k-shui are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

**This file is generated.** From `0.1.0` onward, entries are written by
[release-please](https://github.com/googleapis/release-please) from the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary)
that land on `main`, and new versions are inserted directly below this note. Do
not add sections by hand — write a good pull request title and description
instead. See [`docs/development/releasing.md`](docs/development/releasing.md).

## [0.1.0]

The initial release: everything below was written by hand before the release
automation existed. Operator-safety and incident-ergonomics work driven by a
Kafka-practitioner UX review, on top of the first complete backend, frontend and
packaging drop. Tracked in [`docs/roadmap.md`](docs/roadmap.md) and the
[issue tracker](https://github.com/thadchas/k-shui/issues).

### Security

- **Integration routers now enforce roles.** Schema Registry, Connect, ksqlDB,
  Flink, lineage, metrics, and replication endpoints require `viewer` for reads
  and `editor` for mutations when auth is enabled (previously unauthenticated).
  ⚠️ External OpenLineage producers posting to `POST .../lineage/openlineage`
  now need an editor token.
- Connector configs mask secret-looking keys (`password`, `secret`,
  `credential`, `token`, `*.key`, keystore/truststore) in every view; a masked
  placeholder can never be written back to Connect.
- Session expiry (401) now redirects to `/login` and returns you to the page
  you were on; OIDC cookie sessions bypass the login page.

### Added

- **Live tail** for the message browser (`mode=tail`): follows partitions
  until you stop, with pause/resume buffering, "caught up / N behind" from
  heartbeat events, jump-to-latest, and a follow-key chip.
- Per-partition seek (`startOffsets=p:o,…`), `filterTarget=key|value|header`,
  and `header:<name>=<value>` filters; tombstone badge and hide toggle on
  compacted topics; UTC/local/epoch timestamps; client-side export of the
  on-screen buffer; begin/end offset hints with clamping; copy key/value/offset.
- **Partition remediation** (`/clusters/{c}/partitions/*`): cluster-wide
  unhealthy-partition scan, preferred/unclean leader election (audited),
  rack-aware reassignment planner, reassignment apply with replication
  throttle, and in-flight reassignment listing. Where the Kafka client lacks
  `alter_partition_reassignments` the apply endpoint returns `501` with a
  ready-to-run `kafka-reassign-partitions.sh` JSON + command.
- Overview: clickable URP/offline tiles open a Partition-health panel (elect
  all preferred leaders, rebalance plan); top-lagging consumer groups table;
  health checks sorted unhealthy-first with last-checked time.
- Consumer groups: `timeLagMs` / `maxTimeLagMs` (lag in time from the sampled
  produce rate), lag sparkline, expandable member→partition assignments with
  skew, unassigned-partition callout, server pagination + sort
  (`?page&perPage&sort&order`), partition-scoped offset resets.
- Brokers: disk %-full bars (`logDirTotalBytes`/`logDirUsableBytes` and
  per-dir `totalBytes`/`usableBytes`/`error` when the client exposes
  `describe_log_dirs`), sortable log-dir partition table, offline-dir flag.
- Topics: targeted purge (partition + `beforeOffset`), clone from the detail
  page, "% of topic" partition bars, preferred-leader marking, "only
  unhealthy" partition filter, partition row → messages tab.
- Connect: plugin `/validate` and a diff-before-save on the edit path, Stop
  dialog explaining STOPPED vs PAUSED, bulk Stop and restart-failed-only,
  2-second fast-poll after mutations, connector-level trace, copyable task
  traces, refresh picker.
- Schemas: soft/permanent version delete, `?deleted=true` version listing,
  `inherited` compatibility (`DELETE .../config`), `normalize` on
  compatibility checks, references carried into "New version", protobuf
  validation, polling.
- Flink: savepoint status tracking with copyable external path, current
  (sampled) vs lifetime backpressure, SQL session close/cancel
  (`DELETE .../sql/sessions/{s}/operations/{op}`), grouped exceptions.
- ksqlDB: push vs pull classification, adjustable result ring buffer with
  eviction notice, `POST .../close-query` on stop, persisted recents, clear
  results.
- Shell: RBAC gating on every mutating control (disabled + "Requires editor
  role"), list state in the URL (search/sort/page/filters) on every list
  page, real links in identity cells (cmd/middle-click), keyboard-operable
  rows with `aria-sort`/`aria-live`, `?` shortcuts dialog, `/` focuses table
  search, mobile sidebar drawer, skip link, reduced-motion support,
  unsaved-changes guard on editors, unknown-cluster state, cluster switch
  preserves the section, `/` resumes the last cluster.
- `DELETE /clusters/{c}/partitions/throttle` and a _Clear throttle_ action;
  `GET .../reassignments` reports `throttled`.
- Frontend unit tests (vitest) and CI format/test gates.

### Changed

- `GET /consumer-groups` returns a `{items,total,page,perPage}` envelope
  **only** when `page` is passed; the bare list is unchanged.
- Add-partitions, ACL/quota/dashboard/alert/Flink-cancel/jar/ksql-terminate
  deletes require typed confirmation; internal topics (`__*`) have
  destructive actions disabled in the list and require an acknowledgement on
  the detail page; drained savepoints require an acknowledgement.
- Offset reset Apply is blocked for non-empty groups (the broker would
  reject it); scoping to a partition without commits returns `404` instead
  of resetting the whole topic.
- Unclean leader election requires `admin`. Read-only SQL (`SELECT`/`SHOW`/…)
  in the Flink and ksqlDB editors is viewer-level and allowed on read-only
  clusters; everything else needs `editor`. `sort` keys are whitelisted.
- Message filters are capped at 512 chars and pathological regexes are
  rejected.
- "Settings" under Cluster is now "Cluster settings"; "Share groups" has a
  nav entry.

### Fixed

- `elect_leaders` crashed on confluent-kafka 2.15 (kwargs parsing).
- Soft-deleted schema versions were invisible / 404'd on the detail page.
- Selecting the Alerts History tab wiped every other URL parameter.
- `ErrorBoundary` did not reset on navigation; Cancel was disabled during a
  pending destructive action.

## [0.1.0] — initial release

First public, pre-1.0 release. k-shui is a single-application, Apache-2.0
control center for Apache Kafka and its streaming ecosystem, deployable via
`uvx`, `npx`, Docker, or Helm/Kustomize.

### Added

- **Clusters & brokers** — multi-cluster overview with health checks,
  throughput charts, KRaft quorum view; per-broker config editor, log dirs,
  and metrics.
- **Topics & message browser** — full topic lifecycle (create, configure,
  add partitions, purge, clone, delete); live-tail or paged message browsing
  with string/JSON/Avro/Protobuf/JSON Schema/base64/hex/int/long decoding,
  JSONPath/regex filtering, produce, and JSON/CSV/NDJSON export.
- **Consumer groups & share groups** — lag, members, per-partition detail,
  offset reset (earliest/latest/offset/timestamp/shift-by) with dry-run, and
  Kafka 4.x share groups where supported.
- **Schema Registry** — subjects/versions/diff/compatibility across
  Confluent, Apicurio, and Karapace via the shared `ccompat` API.
- **Kafka Connect** — connector CRUD and lifecycle actions, task status and
  traces, plugin discovery and config validation, offset management, and a
  derived MirrorMaker2/replicator view.
- **ksqlDB** — streaming SQL editor, streams/tables/queries browsers,
  statement history.
- **Flink** — jobs, execution graph, checkpoints, exceptions, task managers,
  jar upload/run, savepoints, and an optional SQL Gateway console.
- **Metrics** — Prometheus-backed dashboards (cluster/brokers/topics/
  consumer-lag/Connect/Flink/JVM/KRaft built-in), a PromQL explorer, Grafana
  JSON dashboard import, and a zero-dependency sampled-metrics fallback when
  Prometheus isn't configured.
- **Stream lineage** — OpenLineage/Marquez-backed graph merged with
  k-shui-derived edges from Connect, ksqlDB, Flink, and consumer groups.
- **Alerts** — metric-based triggers with buffered conditions across
  cluster/broker/topic/consumer-group/connector/ksqlQuery/flinkJob/custom
  PromQL components, email/Slack/PagerDuty/Teams/webhook notification
  actions, and firing/resolved history.
- **Security** — ACLs, quotas, SCRAM users, cluster dynamic configs.
- **Audit log** — every mutating action recorded with user, action,
  resource, and cluster.
- **Auth & RBAC** — none/basic/OIDC auth with admin/editor/viewer roles,
  optional per-user cluster scoping, light/dark theme.
- **Deployment** — `uvx k-shui` / `npx k-shui` / Docker image / Docker
  Compose demo stack / Helm chart / Kustomize base+overlays; health probes,
  Prometheus `/metrics`, optional OpenTelemetry traces, structured logs.

[0.1.0]: https://github.com/thadchas/k-shui/releases/tag/v0.1.0
