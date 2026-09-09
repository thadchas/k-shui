# Consumers & share groups

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its consumer workspace inspects group state, lag, and
membership; resets or deletes offsets; and shows Kafka 4.x share groups where
available.

## k-shui Agent workflow

Select **Investigate** on a consumer-group detail page to carry the group,
cluster, and current time window into k-shui Agent. Inspect mode retrieves
bounded membership, assignments, offsets, watermarks, and calculated lag.
`Stable` describes membership only; missing offsets or watermarks leave lag
unknown rather than reporting zero.

[k-shui Agent](../k-shui-agent.md) is disabled by default and requires an
authenticated k-shui user.

Operate mode can prepare an offset reset only after consumers are stopped and
a successful dry run resolves exact per-partition offsets. The preview expires
after five minutes and requires the human to type the group name before
execution. Deleting a group or its offsets and inspecting Kafka record
payloads remain outside the agent; use the visual workspace and direct k-shui engine APIs for them.

## UI walkthrough

1. `/c/:cluster/consumers` — server-paginated, sortable table of groups:
   type (`classic`/`consumer`/`share`), state, coordinator, member/topic/
   partition counts, total lag, and **lag (time)** — an estimate of how far
   behind the group is in wall-clock terms, derived from the topic's sampled
   produce rate (`—` when unknown, never a misleading 0). Filter by search or
   state; the whole view is in the URL, so it's shareable.
2. `/c/:cluster/consumers/:group` tabs:
   - **Overview** — summary, a total-lag sparkline, per-topic lag rollup.
   - **Partitions** — current offset, end offset, lag, lag (time), and owning
     member/client/host per partition, with a callout listing partitions no
     member owns.
   - **Members** — member id, client id, host; expand a member to see its
     actual topic→partition assignments and a skew indicator versus the mean.
   - **Lag chart** — lag over time per topic.
   - Actions: **Reset offsets** (earliest/latest/specific offset/timestamp/
     shift-by; a dry-run preview with per-partition deltas is mandatory
     before Apply, unchanged rows can be hidden, and Apply is blocked while
     the group has members since the broker would reject it), scoped to a
     topic or specific partitions; **Delete offsets** for a topic; **Delete
     group** (type-to-confirm).
3. `/c/:cluster/consumers/share-groups` — Kafka 4.x share groups (KIP-932);
   shows `{supported: false}` with an explanatory empty state when the
   broker or client library doesn't support them.
4. **Export** the group list as CSV.

## API endpoints

| Method   | Path                                                                        | Notes                                                                                                                             |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/clusters/{c}/consumer-groups?search&state&page&perPage&sort&order` | Bare list, or `{items,total,page,perPage}` when `page` is passed; includes `maxTimeLagMs`                                         |
| `GET`    | `/api/v1/clusters/{c}/consumer-groups/{g}`                                  | Members, per-partition detail, per-topic summary                                                                                  |
| `DELETE` | `/api/v1/clusters/{c}/consumer-groups/{g}`                                  |                                                                                                                                   |
| `POST`   | `/api/v1/clusters/{c}/consumer-groups/{g}/offsets/reset`                    | `{topic?, partitions?, strategy, value?, dryRun?}` → per-partition old/new offset; `404` when none of the scoped partitions exist |
| `DELETE` | `/api/v1/clusters/{c}/consumer-groups/{g}/offsets`                          | `{topic}`                                                                                                                         |
| `GET`    | `/api/v1/clusters/{c}/consumer-groups/{g}/lag-history?range=`               | Series per topic                                                                                                                  |
| `GET`    | `/api/v1/clusters/{c}/consumer-groups/export.csv`                           |                                                                                                                                   |
| `GET`    | `/api/v1/clusters/{c}/share-groups`                                         | `{supported: false}` when unavailable                                                                                             |

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
