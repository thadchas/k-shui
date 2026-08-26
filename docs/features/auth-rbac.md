# Auth & RBAC

## What it does

Controls who can open k-shui and what they can do: no auth (local/demo),
basic auth with three roles, or OIDC/SSO with claim-based role mapping. Plus
the light/dark theme.

## UI walkthrough

- `/login` — shown when `auth.type` is `basic` or `oidc`; basic auth is a
  username/password form, OIDC redirects to your identity provider.
- Once authenticated, the topbar shows the current user and role; `/settings`
  lets an admin manage basic-auth users (username, password, role, optional
  cluster scoping).
- The sidebar's theme toggle switches light/dark (persisted per browser,
  defaults to system preference).
- Read-only-role users see the same pages but every mutating action (create/
  edit/delete buttons, config PUTs, connector/schema/Flink/ksqlDB
  operations) is disabled with a _Requires editor role_ tooltip in the UI
  and rejected (`403`) server-side if attempted directly against the API.
  Viewers can still run read-only SQL (`SELECT`/`SHOW`/`DESCRIBE`) in the
  Flink and ksqlDB editors.
- When a session expires, the next `401` sends you to `/login` and back to
  the page you were on afterwards. An existing OIDC cookie session skips the
  login page.

## Roles

| Role     | Can do                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer` | Read everything the UI exposes (clusters, topics, messages, consumers, schemas, connect, ksql, flink, metrics, lineage, alert history)                                                                                                                |
| `editor` | Everything `viewer` can, plus mutating actions (create/edit/delete topics, offsets, partitions/leader election, schemas, connectors, Flink jobs/jars/SQL DDL, ksqlDB statements, ACLs/quotas, dashboards, alert triggers/actions, OpenLineage ingest) |
| `admin`  | Everything `editor` can, plus user management and app settings                                                                                                                                                                                        |

## API endpoints

| Method | Path                         | Notes                                                                           |
| ------ | ---------------------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/info`               | `{auth:{type, enabled}, ...}` — lets the frontend know whether to show `/login` |
| `GET`  | `/api/v1/auth/me`            | Current principal                                                               |
| `POST` | `/api/v1/auth/login`         | `{username, password}` → `{token, user}` (basic auth)                           |
| `POST` | `/api/v1/auth/logout`        |                                                                                 |
| `GET`  | `/api/v1/auth/oidc/login`    | Starts the OIDC redirect                                                        |
| `GET`  | `/api/v1/auth/oidc/callback` | OIDC callback → `{token, user}`                                                 |

## Config required

```yaml
auth:
  type: none | basic | oidc
  sessionHours: 12
  users: # type: basic
    - username: admin
      password: "$argon2..." # argon2 hash recommended; plaintext only for local dev
      role: admin
      clusters: null # null = all clusters; or a list to scope a user
  oidc: # type: oidc
    issuer: https://idp.example.com/realms/main
    clientId: k-shui
    clientSecret: ${OIDC_CLIENT_SECRET}
    scopes: [openid, profile, email]
    rolesClaim: roles
    adminRoles: [admin]
    editorRoles: [editor]
    defaultRole: viewer # or "none" to deny anyone without a mapped role
```

## Tips / limitations

- **`auth.type: none` (the default) grants every visitor admin access** —
  fine for a laptop demo, not for anything reachable beyond localhost. See
  [`../deployment/security-hardening.md`](../deployment/security-hardening.md).
- Basic-auth passwords should be `argon2` hashes in the config; plaintext is
  accepted only to make local dev config-writing painless, and is called out
  explicitly wherever it's documented.
- Sessions are signed JWTs; without an explicit `auth.jwtSecret` (or
  `$KSHUI_JWT_SECRET`), a random secret is generated per process start, so
  all sessions are invalidated on every restart — set it explicitly for a
  multi-replica or restart-prone deployment.
- `oidc.rolesClaim` must point at a claim containing role strings (a scalar
  or array) present in the ID token/userinfo response; map your IdP's
  groups/roles to `adminRoles`/`editorRoles` accordingly, and set
  `defaultRole: none` if unmapped users should be denied rather than getting
  viewer access.
