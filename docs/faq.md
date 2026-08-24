# FAQ

**Is k-shui affiliated with Confluent or the Apache Software Foundation?**
No. k-shui is an independent, Apache-2.0 licensed open-source project. Apache
Kafka®, Apache Flink®, and Apache® are trademarks of the ASF. "Confluent
Control Center" is Confluent's product name, referenced here only for
feature comparison.

**Does k-shui require Confluent Platform?**
No. k-shui works against any Kafka distribution that speaks the standard
Kafka Admin/client protocol — Apache Kafka, Confluent Platform/Cloud,
Strimzi, Amazon MSK, Redpanda, etc. — and against any `ccompat`-speaking
schema registry (Confluent SR, Apicurio, Karapace).

**Do I need Kafka Connect / ksqlDB / Flink / Prometheus / Marquez to use k-shui?**
No — every integration in `clusters[]` is optional and independent. Configure
only what you run; unconfigured integrations simply don't show that nav item
(or show a "not configured" empty state), and the rest of the app works
normally.

**What happens if an integration is configured but temporarily down?**
That feature's pages show a "not reachable" empty state and API calls return
`503 problem+json` with `type: .../integration-unavailable`. It doesn't crash
k-shui or block unrelated pages. `k-shui check` is the fastest way to see
what's currently reachable — see [getting-started.md](getting-started.md).

**Where does k-shui store its own state (alerts, dashboards, users, audit log)?**
In its own database — SQLite by default (`sqlite+aiosqlite:///./k-shui.db`),
or Postgres (`database.url: postgresql+asyncpg://...`, needs the `postgres`
extra) for multi-replica or durable deployments. This is separate from your
Kafka cluster's own data. See [architecture.md](architecture.md#data-stores).

**Is it safe to expose k-shui outside localhost?**
Not with the defaults. `auth.type: none` (the default) grants every visitor
admin access. Set `auth.type: basic` or `oidc` and work through
[`deployment/security-hardening.md`](deployment/security-hardening.md)
before exposing it beyond a trusted network.

**Can I make k-shui read-only?**
Yes — `server.readOnly: true` blocks every mutating request cluster-wide, or
set `clusters[].readOnly: true` per cluster. Combine with the `viewer` role
for a fully audit-safe, look-but-don't-touch deployment.

**Why do I see a Protobuf field with a placeholder instead of the decoded value?**
The Confluent wire header (magic byte, schema id, message index) is always
parsed; decoding the message body requires compiling the registry's `.proto`
source on the fly, which can fail for schemas with unresolvable imports or
unsupported proto features. k-shui returns a structured placeholder for that
message rather than failing the whole browse — see
[features/messages.md](features/messages.md#tips--limitations).

**Why don't I see JVM/GC/latency-percentile metrics on the broker page?**
Those only exist via a JMX exporter scraped by Prometheus. Without
`clusters[].prometheus` configured, k-shui falls back to Admin-API-sampled
metrics (`metricsMode: sampled`), which covers throughput and replication
counts but not JVM internals. See [features/metrics.md](features/metrics.md).

**Do share groups work on my cluster?**
Only on Kafka 4.x with share groups (KIP-932) enabled. Elsewhere,
`GET /share-groups` returns `{supported: false}` and the UI shows an
explanatory empty state rather than erroring.

**Can I import my existing Grafana dashboards?**
Yes — `POST /api/v1/metrics/dashboards/import` accepts Grafana dashboard
JSON and maps its panels/queries into k-shui's dashboard model, provided
`clusters[].prometheus` is configured (Grafana-only features with no PromQL
equivalent are dropped). See [features/metrics.md](features/metrics.md).

**How is this different from Kafbat UI / AKHQ / Redpanda Console?**
Those are excellent, focused Kafka browsers. k-shui additionally operates
Kafka Connect (+MirrorMaker2 view), ksqlDB, Flink, Prometheus-backed
dashboards, OpenLineage lineage, and a Control-Center-style alerting engine
in the same app. See [comparison.md](comparison.md).

**Where do I report a security issue?**
Do not open a public issue — see [`../SECURITY.md`](../SECURITY.md) for the
private disclosure process.

**How do I get help or discuss a feature?**
Open a GitHub issue or discussion at
[github.com/thadchas/k-shui](https://github.com/thadchas/k-shui). See
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) if you'd like to contribute.
