# Comparison and migration guide

k-shui is designed around an agent-driven workflow: the k-shui Agent uses the
k-shui engine to investigate Kafka and connected streaming systems, then
presents evidence and exact operation previews in the same visual workspace as
the direct expert controls.

The implemented Agent MVP is optional, disabled by default, and limited to the
inspection tools and topic, connector, and consumer-offset operations in
[`k-shui-agent.md`](k-shui-agent.md). The other pages listed below are direct
management and evidence surfaces; listing one does not mean the Agent can
operate every action on that page.

## Evaluate the workflow

Use the current release and its documentation to evaluate these k-shui
characteristics against your requirements:

- **Investigate with evidence:** start with **Ask K-Shui** or a scoped
  **Investigate** action, then review timestamped evidence and its limitations
  in the visual workspace.
- **Keep human control:** Inspect mode cannot mutate resources. Operate mode
  prepares an exact supported change for review and requires typed confirmation
  for consequential actions.
- **Use one engine:** the k-shui engine provides Kafka, Kafka Connect, Schema
  Registry, ksqlDB, Flink, metrics, lineage, alerting, audit, and direct REST
  surfaces according to the configured integrations.
- **Deploy explicitly:** Agent access requires authentication and administrator
  configuration. Agent-enabled deployments currently run in one application
  process.
- **Retain direct tools:** operators can move from Agent evidence to the linked
  topic, consumer, connector, job, schema, lineage, alert, or audit view for
  direct inspection and expert control.

## Navigation for Control Center users

This table is a navigation aid for common operational areas. Verify exact
behavior and compatibility in the linked k-shui feature documentation and in
the version of Confluent Control Center you are moving from.

| Familiar area                     | k-shui destination                               |
| --------------------------------- | ------------------------------------------------ |
| Cluster overview and health       | [`/c/:cluster/overview`](features/clusters.md)   |
| Brokers                           | [`/c/:cluster/brokers`](features/brokers.md)     |
| Topics                            | [`/c/:cluster/topics`](features/topics.md)       |
| Message inspection and production | [Topic → Messages](features/messages.md)         |
| Consumer groups                   | [`/c/:cluster/consumers`](features/consumers.md) |
| Kafka Connect                     | [`/c/:cluster/connect`](features/connect.md)     |
| Replication connectors            | [`/c/:cluster/replication`](features/connect.md) |
| ksqlDB                            | [`/c/:cluster/ksql`](features/ksqldb.md)         |
| Schema Registry                   | [`/c/:cluster/schemas`](features/schemas.md)     |
| Metrics dashboards                | [`/c/:cluster/metrics`](features/metrics.md)     |
| Alerts                            | [`/alerts`](features/alerts.md)                  |
| Stream lineage                    | [`/c/:cluster/lineage`](features/lineage.md)     |
| ACLs and quotas                   | [`/c/:cluster/security`](features/security.md)   |
| Audit log                         | [`/audit`](features/settings-and-audit.md)       |
| Authentication and roles          | [`/settings`](features/auth-rbac.md)             |
| Flink                             | [`/c/:cluster/flink`](features/flink.md)         |

## Evaluating alongside other Kafka UIs

When comparing k-shui with Kafbat UI, AKHQ, Redpanda Console, or another Kafka
UI, test the current versions against the same cluster, identity, and workflows.
For k-shui, include the Agent investigation and review flow as well as the
direct pages, configured integrations, deployment model, and security
boundaries described above. Product capabilities and packaging change over
time, so do not treat historical feature matrices as release evidence.

## Where k-shui is not the right fit yet

- You need an unauthenticated or multi-process Agent deployment. The Agent
  requires authentication and currently runs in one application process.
- You need arbitrary autonomous Kafka administration. Agent operations require
  exact human review and are limited to the documented MVP actions.
- You need Confluent Cloud billing or account-management screens.
- You need a Kafka Streams topology visualizer.
- You need per-resource multi-tenant authorization finer than k-shui's current
  cluster-scoped viewer, editor, and admin roles.

Apache Kafka, Kafka, and Apache are either registered trademarks or trademarks
of the Apache Software Foundation in the United States and/or other countries.
Confluent and other product names are trademarks of their respective owners.
