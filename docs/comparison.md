# Comparison

## vs. Confluent Control Center

Control Center is bundled with (and license-gated to) Confluent Platform.
k-shui is Apache-2.0, works against any Kafka distribution, and maps roughly
1:1 onto Control Center's feature set — here's where to find each:

| Control Center                                        | k-shui page                                      | Notes                                                                     |
| ----------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Cluster overview / System Health                      | [`/c/:cluster/overview`](features/clusters.md)   | Includes KRaft quorum, which C2 doesn't show (C2 targets ZK-era clusters) |
| Brokers                                               | [`/c/:cluster/brokers`](features/brokers.md)     |                                                                           |
| Topics                                                | [`/c/:cluster/topics`](features/topics.md)       |                                                                           |
| Message viewer / production tools                     | [Topic → Messages](features/messages.md)         | k-shui adds JSONPath/regex filtering and NDJSON/CSV export                |
| Consumers                                             | [`/c/:cluster/consumers`](features/consumers.md) | Includes Kafka 4.x share groups, which C2 predates                        |
| Connect Manager                                       | [`/c/:cluster/connect`](features/connect.md)     |                                                                           |
| Replicator monitoring                                 | [`/c/:cluster/replication`](features/connect.md) | k-shui auto-detects MirrorMaker2 as well as Confluent Replicator          |
| ksqlDB                                                | [`/c/:cluster/ksql`](features/ksqldb.md)         |                                                                           |
| Schema Registry management                            | [`/c/:cluster/schemas`](features/schemas.md)     | k-shui also supports Apicurio and Karapace, not just Confluent SR         |
| System Health metrics / built-in Grafana-esque charts | [`/c/:cluster/metrics`](features/metrics.md)     | k-shui's dashboards are user-editable and import Grafana JSON             |
| Alerting (triggers, notifications)                    | [`/alerts`](features/alerts.md)                  | Adds Teams and generic webhook actions alongside email/Slack/PagerDuty    |
| Stream Lineage (Confluent's paid-tier feature)        | [`/c/:cluster/lineage`](features/lineage.md)     | Open-source via OpenLineage/Marquez, not gated to a paid tier             |
| Security (ACLs, quotas)                               | [`/c/:cluster/security`](features/security.md)   |                                                                           |
| Audit Log                                             | [`/audit`](features/settings-and-audit.md)       |                                                                           |
| RBAC                                                  | [`/settings`](features/auth-rbac.md)             | Basic auth or OIDC vs. C2's Confluent-RBAC/LDAP                           |
| **Flink operations**                                  | [`/c/:cluster/flink`](features/flink.md)         | **Not present in Control Center at all**                                  |

Not carried over: Confluent-specific licensing/billing screens, Confluent
Cloud-only connector marketplace UI, and tiered-storage-specific views tied
to Confluent Server (tracked on the [roadmap](roadmap.md) as a general
tiered-storage view).

## Feature matrix vs. other open-source UIs

See the table in the [root README](../README.md#how-it-compares) for a quick
side-by-side against Kafbat UI, AKHQ, and Redpanda Console. The short version:
those tools are excellent, focused Kafka topic/consumer/ACL browsers — none
of them also operates Flink, ksqlDB dashboards, Prometheus-backed metrics
dashboards, OpenLineage lineage, or a Control-Center-style alerting engine in
the same app. If all you need is topic/consumer browsing, any of them (plus
k-shui) will serve you well; k-shui's reason to exist is not re-running five
separate UIs once Connect, Flink, schemas, metrics, lineage and alerting all
enter the picture.

## Where k-shui is _not_ the right fit (yet)

- You need Confluent Cloud billing/quota-management screens — those are
  intentionally out of scope.
- You need a Kafka Streams topology visualizer — not yet built, see the
  [roadmap](roadmap.md).
- You need deep multi-tenant RBAC (per-resource, not just per-cluster) —
  today's roles are cluster-scoped viewer/editor/admin; finer-grained RBAC
  is on the roadmap.
