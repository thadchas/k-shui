# Topics

## What it does

Create, inspect, configure, and delete topics; add partitions; purge or clone
a topic; see per-topic consumers, metrics, and schema linkage.

## UI walkthrough

1. `/c/:cluster/topics` — searchable, paginated, sortable table: partitions,
   replication factor, under-replicated count, size, message count (end −
   begin offset sum), cleanup policy, retention, schema badges, throughput.
   Toggle to show internal topics (`__consumer_offsets`, etc.).
2. `/c/:cluster/topics/new` — name, partitions, replication factor, and a
   config key/value editor (with common presets like `cleanup.policy`,
   `retention.ms`).
3. `/c/:cluster/topics/:topic` tabs:
   - **Overview** — summary + per-partition detail (leader, replicas, ISR,
     begin/end offset, size).
   - **Messages** — the message browser, see [messages.md](messages.md).
   - **Partitions** — add partitions (`POST .../partitions {count}`); note
     this is one-way (you can't reduce partition count).
   - **Configs** — full topic config, incremental-alter editable, with a
     diff-from-default indicator.
   - **Consumers** — which consumer groups read this topic and their lag.
   - **Schema** — key/value schema linkage from the registry (subject,
     version, schema id, strategy).
   - **Metrics** — messagesIn, bytesIn, bytesOut, size over time.
   - **Lineage** — this topic's neighborhood in the lineage graph.
   - Row/page actions: **Purge** (delete records, optionally per-partition up
     to an offset), **Clone** (copy config to a new topic), **Delete**
     (type-to-confirm).

## API endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/clusters/{c}/topics?search&showInternal&page&perPage&sort&order` | List |
| `POST` | `/api/v1/clusters/{c}/topics` | `{name, partitions, replicationFactor, configs}` |
| `GET` | `/api/v1/clusters/{c}/topics/{t}` | Detail incl. `partitionsDetail[]` |
| `DELETE` | `/api/v1/clusters/{c}/topics/{t}` | |
| `GET`/`PUT` | `/api/v1/clusters/{c}/topics/{t}/configs` | Incremental alter on `PUT` |
| `POST` | `/api/v1/clusters/{c}/topics/{t}/partitions` | `{count}` |
| `POST` | `/api/v1/clusters/{c}/topics/{t}/purge` | `{partitions?:[{id, beforeOffset}]}` — default deletes all to end |
| `POST` | `/api/v1/clusters/{c}/topics/{t}/clone` | `{name}` — config copy only |
| `GET` | `/api/v1/clusters/{c}/topics/{t}/consumers` | `[{groupId, state, lag, members}]` |
| `GET` | `/api/v1/clusters/{c}/topics/{t}/metrics?range=` | Time series |
| `GET` | `/api/v1/clusters/{c}/topics/{t}/schema` | Key/value schema linkage |

## Config required

None beyond `clusters[].bootstrapServers`. The **Schema** tab needs
`clusters[].schemaRegistry`; the **Metrics** tab is richer with
`clusters[].prometheus`.

## Tips / limitations

- Purge and delete are destructive and irreversible — both require
  type-to-confirm in the UI and are always audited.
- Partition count can only increase; k-shui does not offer partition
  reduction (Kafka doesn't support it either).
- `messageCount` is `endOffset − beginOffset` summed across partitions — it's
  an approximation when compaction or transactional/control records are in
  play, not an exact live message count.
