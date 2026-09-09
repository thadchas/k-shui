# Agent-driven Kafka management roadmap

k-shui is pre-1.0 and under active development. This is a living, directional
list, not a committed schedule — see the [issue tracker](https://github.com/thadchas/k-shui/issues)
for what's actually being worked on, and [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
to help push something up the list.

## Product priority: investigations and reviewed operations

Lead with **k-shui Agent** as the way to investigate Kafka and request supported
changes. The **k-shui engine** connects services, enforces authority, and records
outcomes; the visual workspace gives operators the underlying resources and
expert controls. Prioritize useful evidence, clear next steps, and trustworthy
execution before expanding the number of tools or providers.

The current workspace includes an agent MVP with scoped investigations,
evidence links, saved history, bounded runs, and selected topic, connector/task,
and consumer-offset operations. It is disabled by default, requires sign-in,
and separates preparation from user-triggered execution. See
[the current capability guide](k-shui-agent.md), including its single-process
requirement and outstanding live-validation work. This is not a claim that the
MVP has shipped in a published package or passed production evaluation.

The [product direction](product-improvement-plan.md) explains the investigation
experience and proposed follow-on work. Expanded administrative tools, additional
agent runtimes/providers, payload sampling, and unattended remediation are not
current capabilities. The sections below retain platform milestones and
candidate ideas; their version labels do not override current code or release
evidence. Finalized work follows the [planning policy](../AGENTS.md#publish-finalized-plans).

## v0.1 — initial release

The current baseline: multi-cluster clusters/brokers/topics/messages,
consumer groups (+ Kafka 4.x share groups), Schema Registry (Confluent/
Apicurio/Karapace), Kafka Connect (+ MirrorMaker2 view), ksqlDB, Flink
(jobs/checkpoints/graph/SQL Gateway/jars), Prometheus-backed metrics
dashboards with sampled-metrics fallback, OpenLineage/Marquez lineage,
Control-Center-style alerting (email/Slack/PagerDuty/Teams/webhook), ACLs/
quotas/SCRAM/KRaft quorum, audit log, basic/OIDC auth, light/dark theme. See
[`CHANGELOG.md`](../CHANGELOG.md).

## Operator safety & incident ergonomics baseline

The changelog records the earlier Kafka-practitioner UX work in
[`0.1.0`](../CHANGELOG.md#010): role enforcement on every
integration router and RBAC gating in the UI, connector secret masking, live
tail with pause / follow-key / header filters, per-partition seek, partition
health with preferred-leader election and reassignment planning, lag in
time, dry-run-gated and partition-scoped offset resets, typed confirmations
everywhere, URL-shareable list views, keyboard/a11y pass, frontend unit
tests.

Known gaps carried forward:

- **Partition reassignment apply** needs `confluent-kafka` with
  `alter_partition_reassignments`; today the plan endpoint returns the
  `reassignment.json` + CLI command and apply answers `501`.
- **Disk capacity** (`totalBytes`/`usableBytes`) needs `describe_log_dirs`
  in the Kafka client; otherwise only bytes-used is shown.
- **Lag in time** depends on the metrics sampler having two samples for the
  topic; new or idle topics show `—`.
- **No browser end-to-end tests yet** — unit tests cover hooks, helpers, and
  the destructive-dialog gates; API behaviour is validated against a live
  Kafka 4.3 cluster manually.

## Near-term supporting capabilities (v0.2 – v0.4)

- **Kafka Streams topology view** — visualize a Kafka Streams application's
  sub-topology graph (source/processor/sink nodes, state stores,
  repartition topics), similar in spirit to the Flink execution graph view.
- **Schema evolution wizard** — guided, compatibility-aware flow for editing
  a schema (add optional field, widen a type, etc.) with a live
  compatibility check against the target mode before you commit a new
  version.
- **Distributed alert engine / metrics sampler** — leader-elected or
  externally-schedulable evaluation so multi-replica deployments don't rely
  on "exactly one replica is up" for alerting and sampled-metrics history.
- **Deeper Connect plugin config UX** — inline docs, grouped/conditional
  fields rendered from `dependents`, and connector-class-specific presets
  for common connectors (S3, JDBC, Debezium, MirrorMaker2).
- **Consumer group rebalance insight** — visualize partition assignment
  changes over time, not just a lag snapshot.

## Mid-term supporting capabilities (v0.5 – v0.8)

- **Multi-tenant RBAC** — per-resource (topic/consumer-group/connector
  pattern) permissions layered on top of today's cluster-scoped
  viewer/editor/admin roles, so a team can be scoped to `orders-*` topics
  rather than a whole cluster.
- **Redpanda / WarpStream adapters** — first-class handling of
  platform-specific Admin API extensions and metrics (beyond today's
  "any Kafka-protocol cluster works") for smoother onboarding of
  Redpanda- and WarpStream-native features.
- **Tiered storage view** — visibility into local-vs-remote log segment
  placement and remote storage usage for brokers/topics using Kafka tiered
  storage (KIP-405) or vendor equivalents.
- **OpenTelemetry tracing across proxy calls** — propagate trace context
  from the browser through k-shui's proxy calls into Kafka/Connect/Flink/etc.
  requests, so a slow page load is traceable end to end, not just at the
  k-shui process boundary.
- **Saved views** — the current workspace includes browser-local named topic
  views and message-search presets. Team sharing and server-managed persistence
  remain separate work; browser-local views are not agent investigation history.

## Longer-term (toward v1.0)

- **Declarative/GitOps config** — apply topic/ACL/quota/connector desired
  state from a YAML/CRD source, with drift detection against the running
  cluster.
- **Cross-cluster diff and promotion** — compare topic configs, ACLs, and
  connector configs between two clusters (e.g. staging vs. prod) and
  promote a change.
- **Plugin/extension points** — a documented way to add a custom alert
  action type or a custom lineage source without forking k-shui.
- **1.0**: API stability guarantee on `/api/v1`, a documented upgrade path
  for the config schema, and completion of the multi-tenant RBAC and
  distributed-scheduling items above.

Have a feature you need sooner? Open a
[GitHub issue](https://github.com/thadchas/k-shui/issues) describing your use
case — roadmap ordering is driven by real usage, not this list alone.
