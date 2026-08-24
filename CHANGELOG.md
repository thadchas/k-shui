# Changelog

All notable changes to k-shui are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) once released.

## [Unreleased]

Tracked in [`docs/roadmap.md`](docs/roadmap.md) and the
[issue tracker](https://github.com/thadchas/k-shui/issues).

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

[Unreleased]: https://github.com/thadchas/k-shui/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thadchas/k-shui/releases/tag/v0.1.0
