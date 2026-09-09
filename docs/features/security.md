# Security

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its security workspace provides Kafka-side
administration: ACLs, quotas, SCRAM users, cluster dynamic configs, and the
KRaft controller quorum. (For k-shui's _own_ login and role-based access, see
[auth-rbac.md](auth-rbac.md).)

## k-shui Agent boundary

k-shui Agent enforces the signed-in human user's current k-shui role and
cluster grants on every tool call. Inspect mode exposes only its bounded
metadata allowlist; it cannot enumerate arbitrary ACL, quota, SCRAM, broker
configuration, or credential data.

[k-shui Agent](../k-shui-agent.md) is disabled by default and requires an
authenticated k-shui user.

Operate mode does not create or delete ACLs, change quotas or SCRAM users,
edit cluster/broker settings, elect leaders, or run shell commands. Use the
visual workspace and direct engine APIs for the supported administrative
actions documented below. The application does not expose a shell executor. The agent's model credential grants no Kafka permissions.

## UI walkthrough

`/c/:cluster/security` tabs:

- **ACLs** — list filtered by resource type/name/principal; create/delete an
  ACL (resource type, resource name, pattern type literal/prefixed,
  principal, host, operation, permission type allow/deny).
- **Quotas** — per user / client-id / IP entity: producer/consumer byte-rate
  and request-percentage limits; edit or delete.
- **SCRAM users** — list/create/delete SCRAM-SHA credentials on the cluster.

`/c/:cluster/settings`:

- Cluster-level dynamic configs (broker-default overrides).
- **KRaft quorum** — leader id/epoch, high watermark, per-voter/observer log
  end offset, last fetch/caught-up timestamps, and lag — useful for spotting
  a lagging or unavailable controller before it becomes an outage.

## API endpoints

| Method                | Path                                | Notes                                                                                           |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET`/`POST`/`DELETE` | `/api/v1/clusters/{c}/acls`         | Filter by `resourceType`, `resourceName`, `principal`                                           |
| `GET`/`PUT`/`DELETE`  | `/api/v1/clusters/{c}/quotas`       | `{entityType, entityName, quotas:{producer_byte_rate, consumer_byte_rate, request_percentage}}` |
| `GET`/`POST`/`DELETE` | `/api/v1/clusters/{c}/scram-users`  |                                                                                                 |
| `GET`/`PUT`           | `/api/v1/clusters/{c}/configs`      | Cluster-level dynamic configs                                                                   |
| `GET`                 | `/api/v1/clusters/{c}/kraft/quorum` | `{leaderId, leaderEpoch, highWatermark, voters, observers}`                                     |

## Config required

None beyond `clusters[].bootstrapServers` — but the principal k-shui
authenticates to Kafka as (`clusters[].properties` SASL/mTLS identity) needs
`Describe`/`Alter` ACL permission on the relevant resources, or these calls
fail with an authorization error surfaced as `problem+json`.

## Tips / limitations

- ACL and quota changes take effect immediately cluster-wide — there's no
  staging/dry-run for these (unlike topic-config PUTs, which are still
  live but scoped to one resource).
- `kraft/quorum` only returns meaningful data on a KRaft cluster (no
  ZooKeeper); on a ZK-based cluster it reports the controller isn't KRaft.
- All writes here are blocked when `server.readOnly` or
  `clusters[].readOnly` is set, and are always audited (see
  [settings-and-audit.md](settings-and-audit.md)).
