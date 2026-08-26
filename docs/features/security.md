# Security

## What it does

Kafka-side security administration: ACLs, quotas, SCRAM users, cluster
dynamic configs, and the KRaft controller quorum. (For k-shui's _own_ login
and role-based access, see [auth-rbac.md](auth-rbac.md).)

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
