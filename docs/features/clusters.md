# Clusters

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. The cluster landing page and sidebar switcher establish
the scope used by the k-shui engine and every investigation
(`/c/:cluster/...`).

## What it does

- Lists every cluster from `clusters:` in your config as a card: status
  (`online`/`degraded`/`offline`), Kafka version, broker/topic/partition
  counts, under-replicated/offline partition counts, in-sync-replica %, and
  live bytes-in/out.
- Per-cluster **Overview** page: stat tiles, throughput time series, a health
  checklist, and — for KRaft clusters — quorum state (leader, epoch,
  voters/observers).

## k-shui Agent workflow

Use **Ask K-Shui** in the top bar for a cluster-wide investigation, or select
**Investigate** beside an unhealthy partition to carry that resource and the
current time window into the agent. Inspect mode reads bounded, allowlisted
metadata; cluster health combines current Kafka metadata with sampled
partition health and marks missing or stale telemetry explicitly.

k-shui Agent is disabled by default and requires an authenticated user. It
does not monitor continuously or heal the cluster autonomously. Operate mode
can prepare only the selected topic, connector, and consumer-offset mutations
documented on their feature pages; every preview still requires explicit
human review and execution.

## UI walkthrough

1. `/clusters` — grid of cluster cards. Click a card to enter that cluster.
2. `/c/:cluster/overview` — stat tiles at top (brokers online, topics,
   under-replicated partitions, offline partitions — click either to open
   the **Partition health** panel), throughput charts (bytes in/out,
   messages in, request rate) with a time-range picker, a health-checks
   list (unhealthy first, expandable, with _last checked_), a **Partition
   health** card (offline / under-replicated / non-preferred-leader
   partitions with _Elect preferred leaders_ and a cluster-wide _Rebalance
   plan…_), a **top lagging consumer groups** table, and a KRaft quorum
   panel.
3. The cluster switcher in the sidebar top is available from every page and
   keeps you in the same section (`/c/a/topics` → `/c/b/topics`); `/`
   reopens the last cluster you used.

## API endpoints

| Method | Path                                           | Notes                                                                                                     |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/clusters`                             | List, with `features:{schemaRegistry,connect,ksqldb,flink,prometheus,lineage}` flags per cluster          |
| `GET`  | `/api/v1/clusters/{c}`                         | Detail: listeners, `kraft:{leaderId, epoch, voters, observers}`                                           |
| `GET`  | `/api/v1/clusters/{c}/health`                  | `{status, checks:[{name, status, message}]}`                                                              |
| `GET`  | `/api/v1/clusters/{c}/overview/metrics?range=` | Series: bytesIn, bytesOut, messagesIn, requestRate, activeControllers, underReplicated, offlinePartitions |

## Config required

Just `clusters[].id` and `clusters[].bootstrapServers`. The `features` flags
reflect whatever else you've configured (`schemaRegistry`, `connect`, etc.) —
they drive which nav items appear per cluster.

## Tips / limitations

- Overview metrics come from Prometheus when `clusters[].prometheus` is set
  and `metricsMode: prometheus` (the default once `prometheus:` is present);
  otherwise they're sampled from the Admin API into an in-memory ring buffer
  (`metricsMode: sampled`) — shorter history, resets on restart. See
  [metrics.md](metrics.md).
- `status: degraded` generally means under-replicated or offline partitions
  exist even though the cluster is reachable; `offline` means k-shui can't
  reach any broker.
