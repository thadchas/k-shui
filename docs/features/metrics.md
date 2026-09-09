# Metrics

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its observability workspace provides Grafana-equivalent
dashboards over Prometheus, plus a raw PromQL explorer: built-in dashboards
for cluster/broker/topic/consumer-lag/Connect/Flink/JVM/KRaft, and support for
importing your own Grafana JSON dashboards.

## k-shui Agent boundary

Use **Ask K-Shui** for a cluster-scoped investigation. Inspect mode can use
the bounded health and resource summaries in its allowlist, including sampled
partition health with retrieval timestamps. It does not expose an arbitrary
PromQL tool, dashboard panels, or the full metrics catalog to the model.

[k-shui Agent](../k-shui-agent.md) is disabled by default and requires an
authenticated k-shui user.

Create dashboards and run PromQL through the visual workspace and direct k-shui engine APIs below.
Operate mode has no metrics or dashboard mutation, and the agent does not
monitor continuously or heal from metric changes automatically.

## UI walkthrough

1. `/c/:cluster/metrics` — dashboard list: built-in dashboards
   (`cluster-overview`, `brokers`, `topics`, `consumer-lag`, `connect`,
   `flink`, `jvm`, `kraft`) plus any user-created/imported ones.
2. `/c/:cluster/metrics/:dashboard` — rows of panels (timeseries, stat,
   gauge, table, bar, heatmap), each with one or more PromQL queries,
   variables (e.g. a topic/broker picker that re-templates queries), units,
   and thresholds. Time-range and refresh-interval pickers apply globally.
3. `/c/:cluster/metrics/explore` — a raw PromQL box against the cluster's
   Prometheus (with the cluster's label selectors auto-injected), for
   ad-hoc queries beyond the built-in dashboards.
4. Create/edit/delete custom dashboards, or **import a Grafana dashboard
   JSON** directly.

## API endpoints

| Method                | Path                                                                | Notes                                                  |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `GET`                 | `/api/v1/clusters/{c}/metrics/status`                               | `{configured, url, reachable, buildInfo, targets}`     |
| `GET`                 | `/api/v1/clusters/{c}/metrics/query?query&time`                     | Instant PromQL proxy                                   |
| `GET`                 | `/api/v1/clusters/{c}/metrics/query_range?query&start&end&step`     | Range PromQL proxy                                     |
| `GET`                 | `/api/v1/clusters/{c}/metrics/catalog?search`                       | Metric names + help, for autocomplete                  |
| `GET`                 | `/api/v1/clusters/{c}/metrics/dashboards`                           | Built-in + user dashboards                             |
| `GET`                 | `/api/v1/clusters/{c}/metrics/dashboards/{id}`                      | Rows/panels/variables definition                       |
| `POST`/`PUT`/`DELETE` | `/api/v1/metrics/dashboards`                                        | User dashboards (SQLite)                               |
| `POST`                | `/api/v1/metrics/dashboards/import`                                 | Grafana-JSON import                                    |
| `GET`                 | `/api/v1/clusters/{c}/metrics/dashboards/{id}/data?range&step&vars` | Evaluates all panels → `{panels:{[panelId]:{series}}}` |

## Config required

`clusters[].prometheus: {url, labels?, auth?}` for real dashboards and
PromQL explore. `clusters[].prometheus.labels` are extra label selectors
injected into every query — set this when one Prometheus instance scrapes
multiple Kafka clusters, so queries don't cross-contaminate.

## Tips / limitations

- **Sampled-metrics fallback**: without Prometheus configured (or with it
  unreachable), `overview`/`broker`/`topic` metric endpoints fall back to
  `metricsMode: sampled` — an in-memory ring buffer built by polling the
  Admin API every `clusters[].pollIntervalSeconds`. This covers throughput
  and replication counts but **not** JVM/GC/latency-percentile metrics
  (those only exist via a JMX exporter scraped by Prometheus), history is
  short and resets on restart, and the `/metrics` dashboards pages
  themselves require Prometheus — sampled mode only backs the simpler
  per-page charts (cluster/broker/topic tabs), not the dashboard system.
- Grafana JSON import maps panel `targets[].expr` 1:1 into k-shui panels;
  Grafana-specific features with no PromQL equivalent (annotations tied to
  Grafana's own alerting, template datasource variables other than a plain
  query) are dropped rather than partially translated.
- The PromQL explorer executes arbitrary queries against your Prometheus —
  scope Prometheus's own access controls accordingly if k-shui runs with a
  shared service account.
