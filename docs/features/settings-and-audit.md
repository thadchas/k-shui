# Settings & audit

## What it does

App-level settings (not Kafka-cluster settings — see
[security.md](security.md) for those) plus a full audit trail of every
mutating action taken through k-shui.

## UI walkthrough

- `/settings` — app info (version, uptime), basic-auth user management (when
  `auth.type: basic`), theme (light/dark, follows system by default), and
  an "about" panel (build info, links).
- `/audit` — paginated, filterable log: timestamp, user, action, resource,
  cluster, a details payload, and source IP. Filter by cluster, user, or
  action type.

## API endpoints

| Method | Path                                               | Notes                                                                        |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`  | `/api/v1/audit?page&perPage&clusterId&user&action` | `{items:[{id, ts, user, action, resource, clusterId, details, ip}]}`         |
| `GET`  | `/api/v1/info`                                     | `{version, uptimeSeconds, auth, features, clusters}` — backs the about panel |

## Config required

None — auditing is always on. `alerts.historyRetentionDays` bounds alert
history but audit-log retention is unbounded by default (prune at the
database level if needed).

## Tips / limitations

- **Every mutating call is audited** (per `ARCHITECTURE.md`) — topic/ACL/
  quota/connector/schema/offset-reset changes, config PUTs, alert
  trigger/action CRUD, and login/logout all show up here with the
  authenticated principal.
- With `auth.type: none`, all actions are attributed to a single anonymous
  identity — the audit log still records _what_ changed, just not _who_
  beyond "anonymous." Set up `basic` or `oidc` auth if per-user
  accountability matters.
- Sensitive config values (SASL/SSL secrets, passwords) are masked in both
  the config editors and the audit `details` payload — they're never
  written to the audit log in plaintext.
