# Consumers & share groups

## What it does

Inspect consumer group state, lag, and membership; reset or delete offsets;
view Kafka 4.x share groups where available.

## UI walkthrough

1. `/c/:cluster/consumers` — table of groups: type (`classic`/`consumer`/
   `share`), state, coordinator, member/topic/partition counts, total lag.
   Filter by search or state.
2. `/c/:cluster/consumers/:group` tabs:
   - **Overview** — summary, per-topic lag rollup.
   - **Partitions** — current offset, end offset, lag, and owning
     member/client/host per partition.
   - **Members** — member id, client id, host, assigned partitions.
   - **Lag chart** — lag over time per topic.
   - Actions: **Reset offsets** (earliest/latest/specific offset/timestamp/
     shift-by, optionally dry-run first, scoped to a topic or specific
     partitions), **Delete offsets** for a topic, **Delete group**.
3. `/c/:cluster/consumers/share-groups` — Kafka 4.x share groups (KIP-932);
   shows `{supported: false}` with an explanatory empty state when the
   broker or client library doesn't support them.
4. **Export** the group list as CSV.

## API endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/clusters/{c}/consumer-groups?search&state` | List |
| `GET` | `/api/v1/clusters/{c}/consumer-groups/{g}` | Members, per-partition detail, per-topic summary |
| `DELETE` | `/api/v1/clusters/{c}/consumer-groups/{g}` | |
| `POST` | `/api/v1/clusters/{c}/consumer-groups/{g}/offsets/reset` | `{topic?, partitions?, strategy, value?, dryRun?}` → per-partition old/new offset |
| `DELETE` | `/api/v1/clusters/{c}/consumer-groups/{g}/offsets` | `{topic}` |
| `GET` | `/api/v1/clusters/{c}/consumer-groups/{g}/lag-history?range=` | Series per topic |
| `GET` | `/api/v1/clusters/{c}/consumer-groups/export.csv` | |
| `GET` | `/api/v1/clusters/{c}/share-groups` | `{supported: false}` when unavailable |

## Config required

None beyond `clusters[].bootstrapServers`.

## Tips / limitations

- **Share groups need Kafka 4.x** with the feature enabled on the broker; on
  earlier clusters (or older `confluent-kafka`/librdkafka builds without
  share-group support) the endpoint reports `supported: false` rather than
  erroring.
- Offset reset against a **running** consumer is refused by Kafka itself for
  active partitions in some strategies — stop or scale the consumer to zero
  first, or use `dryRun: true` to preview without applying.
- Resetting to a `timestamp` uses `offsetsForTimes` semantics: the first
  offset at or after that time per partition.
