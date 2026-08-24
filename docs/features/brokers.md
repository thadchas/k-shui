# Brokers

## What it does

Per-broker operational view: identity (host/port/rack, controller flag),
partition/leader counts, under-replicated partitions, log directory sizes,
dynamic config editing, and metrics.

## UI walkthrough

1. `/c/:cluster/brokers` — table of brokers with status pill, rack, partition
   and leader counts, under-replicated count, log dir size.
2. `/c/:cluster/brokers/:id` tabs:
   - **Overview** — identity, status, counts.
   - **Configs** — full dynamic config list (name, value, source, is-default,
     is-sensitive, documentation), editable inline; sensitive values (e.g.
     SASL/SSL secrets) are masked.
   - **Log dirs** — per-log-dir size and per-partition breakdown
     (topic/partition/size/offset lag).
   - **Metrics** — bytes in/out, request-handler/network-processor idle %,
     produce/fetch p99 latency, JVM heap used, GC time.

## API endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/clusters/{c}/brokers` | List |
| `GET` | `/api/v1/clusters/{c}/brokers/{b}` | Detail |
| `GET` | `/api/v1/clusters/{c}/brokers/{b}/configs` | `[{name, value, source, isDefault, isReadOnly, isSensitive, documentation}]` |
| `PUT` | `/api/v1/clusters/{c}/brokers/{b}/configs` | `{configs:{k:v}}` — incremental alter |
| `GET` | `/api/v1/clusters/{c}/brokers/{b}/logdirs` | `[{path, sizeBytes, partitions:[...]}]` |
| `GET` | `/api/v1/clusters/{c}/brokers/{b}/metrics?range=` | Time series |

## Config required

None beyond `clusters[].bootstrapServers` — broker config editing needs
`AlterConfigs`/`IncrementalAlterConfigs` ACL permission for the principal
k-shui authenticates as (see [security.md](security.md)), and the cluster
must not be `readOnly: true`.

## Tips / limitations

- Config edits are audited (see [settings-and-audit.md](settings-and-audit.md))
  and blocked entirely when the cluster or server is in read-only mode
  (`server.readOnly` or `clusters[].readOnly`).
- Metrics fall back to sampled Admin-API data without Prometheus configured —
  JVM heap/GC and idle-percent series specifically require Prometheus + a JMX
  exporter, since the Admin API doesn't expose them.
