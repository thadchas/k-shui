# Topics

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its topic workspace creates, inspects, configures, and
deletes topics; adds partitions; purges or clones a topic; and shows per-topic
consumers, metrics, and schema linkage.

## k-shui Agent workflow

Use **Ask K-Shui** with the relevant cluster and topic. Inspect mode retrieves
partition metadata and only allowlisted, non-secret topic configuration. In
Operate mode, an explicit human request can prepare topic creation, an
allowlisted config update, partition-count increase, purge, or deletion.

[k-shui Agent](../k-shui-agent.md) is disabled by default and requires an
authenticated k-shui user.

The human reviews the exact target and effect before choosing execute.
Partition increase requires typing the topic name; purge and deletion require
`purge <topic>` and `delete <topic>` respectively;
previews expire after five minutes, and changed resource state requires a new
preview. Internal and reserved topics are excluded. Clone, replica
reassignment, leader election, throttle clearing, arbitrary config keys,
and message production remain outside the agent; use the visual workspace
and direct engine APIs where supported. The agent has no shell tool.

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
     begin/end offset, size, share of the topic). The preferred leader
     (`replicas[0]`) is marked; a partition whose leader isn't preferred gets
     an amber _not preferred_ badge, and an _only unhealthy_ toggle narrows
     to offline / under-replicated partitions. Select partitions to **elect
     the preferred leader**, or open **Reassign replicas…** per partition
     (target replica order, optional replication throttle, in-flight
     `+/-` badges). Clicking a partition row opens the Messages tab seeked to
     it.
   - **Messages** — the message browser, see [messages.md](messages.md).
   - **Partitions** — add partitions (`POST .../partitions {count}`) behind a
     typed confirmation that warns when the topic is compacted (key→partition
     mapping changes) or has active consumer groups; this is one-way (you
     can't reduce partition count).
   - **Configs** — full topic config, incremental-alter editable, with a
     diff-from-default indicator.
   - **Consumers** — which consumer groups read this topic and their lag.
   - **Schema** — key/value schema linkage from the registry (subject,
     version, schema id, strategy).
   - **Metrics** — messagesIn, bytesIn, bytesOut, size over time.
   - **Lineage** — this topic's neighborhood in the lineage graph.
   - Row/page actions: **Purge** (entire topic, or specific partitions up to
     an offset prefilled with the end offset), **Clone** (copy config to a
     new topic), **Delete** (type-to-confirm). Internal topics (`__*`) have
     these actions locked in the list and require an explicit acknowledgement
     on the detail page.

## API endpoints

| Method      | Path                                                                      | Notes                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`       | `/api/v1/clusters/{c}/topics?search&showInternal&page&perPage&sort&order` | List                                                                                                                                                   |
| `POST`      | `/api/v1/clusters/{c}/topics`                                             | `{name, partitions, replicationFactor, configs}`                                                                                                       |
| `GET`       | `/api/v1/clusters/{c}/topics/{t}`                                         | Detail incl. `partitionsDetail[]`                                                                                                                      |
| `DELETE`    | `/api/v1/clusters/{c}/topics/{t}`                                         |                                                                                                                                                        |
| `GET`/`PUT` | `/api/v1/clusters/{c}/topics/{t}/configs`                                 | Incremental alter on `PUT`                                                                                                                             |
| `POST`      | `/api/v1/clusters/{c}/topics/{t}/partitions`                              | `{count}`                                                                                                                                              |
| `POST`      | `/api/v1/clusters/{c}/topics/{t}/purge`                                   | `{partitions?:[{id, beforeOffset}]}` — default deletes all to end                                                                                      |
| `POST`      | `/api/v1/clusters/{c}/topics/{t}/clone`                                   | `{name}` — config copy only                                                                                                                            |
| `GET`       | `/api/v1/clusters/{c}/topics/{t}/consumers`                               | `[{groupId, state, lag, members}]`                                                                                                                     |
| `GET`       | `/api/v1/clusters/{c}/topics/{t}/metrics?range=`                          | Time series                                                                                                                                            |
| `GET`       | `/api/v1/clusters/{c}/topics/{t}/schema`                                  | Key/value schema linkage                                                                                                                               |
| `GET`       | `/api/v1/clusters/{c}/partitions/unhealthy`                               | Cluster-wide offline / under-replicated / non-preferred-leader partitions                                                                              |
| `POST`      | `/api/v1/clusters/{c}/partitions/elect-leaders`                           | `{partitions:[{topic,partition}], electionType:'preferred'\|'unclean'}` (empty = all)                                                                  |
| `POST`      | `/api/v1/clusters/{c}/partitions/reassign/plan`                           | `{topics, brokers?}` → rack-aware balanced plan + reassignment JSON (never applies)                                                                    |
| `POST`      | `/api/v1/clusters/{c}/partitions/reassign`                                | `{partitions:[{topic,partition,replicas}], throttleBytesPerSec?}`; `501` with `kafka-reassign-partitions.sh` payload when the Kafka client can't apply |
| `GET`       | `/api/v1/clusters/{c}/partitions/reassignments`, `.../capabilities`       | In-flight moves (+ `throttled`); which operations the client supports                                                                                  |
| `DELETE`    | `/api/v1/clusters/{c}/partitions/throttle`                                | `{topics?}` — clear replication throttles left by a reassignment                                                                                       |

## Config required

None beyond `clusters[].bootstrapServers`. The **Schema** tab needs
`clusters[].schemaRegistry`; the **Metrics** tab is richer with
`clusters[].prometheus`.

## Tips / limitations

- Purge and delete are destructive and irreversible — both require
  type-to-confirm in the UI and are always audited.
- Partition count can only increase; k-shui does not offer partition
  reduction (Kafka doesn't support it either).
- **Partition reassignment apply** needs a `confluent-kafka` build with
  `AdminClient.alter_partition_reassignments`; on 2.15 (current) the plan is
  still generated and the apply endpoint returns `501` with the exact
  `reassignment.json` and CLI command so you can run it yourself. Leader
  election works on 2.15.
- `messageCount` is `endOffset − beginOffset` summed across partitions — it's
  an approximation when compaction or transactional/control records are in
  play, not an exact live message count.
