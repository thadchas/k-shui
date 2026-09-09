# Security Hardening

k-shui Agent can gather operational evidence and prepare Kafka ecosystem
changes, while the k-shui engine can execute reviewed actions under the acting
user's authority. Protect that workflow with explicit identity, tightly scoped
access, server-side provider credentials, and durable audit data. The defaults
are optimized for a fast local demo; review these controls before exposing
k-shui beyond a trusted network.

## Authentication

- `auth.type: none` (the default) grants every visitor admin access. Set
  `auth.type: basic` (with hashed passwords — `argon2` via `argon2-cffi`, not
  plaintext) or `auth.type: oidc` for anything reachable outside a fully
  trusted network.
- For `basic` auth, store `argon2` hashes in `auth.users[].password`, never
  plaintext, and scope non-admin users to specific clusters via
  `auth.users[].clusters`.
- For `oidc`, set `adminRoles`/`editorRoles`/`defaultRole` deliberately —
  `defaultRole: none` denies anyone without a matching role claim rather than
  defaulting them to `viewer`.
- Set `auth.jwtSecret` explicitly (via `${VAR}` + a Secret — see below) in any
  deployment with more than one replica or that restarts often; otherwise a
  new random secret per process invalidates all sessions on every restart/
  rolling-update and, worse, differs per pod behind a Service, breaking
  sessions non-deterministically.

## Secrets management

Never put AI provider keys, OIDC client secrets, SMTP passwords, or `HttpAuth` credentials
(`schemaRegistry.auth`, `connect[].auth`, `prometheus.auth`, etc.) as
plaintext in a ConfigMap, a compose file, or version control.

- **Kubernetes (Helm)**: use `${VAR}` placeholders in `values.config` and set
  `existingSecret: <name>` — the chart wires that Secret's keys into the
  container via `envFrom`, and k-shui's YAML loader expands `${VAR}` from the
  process environment at load time (`backend/k_shui/config.py::_expand_env`).
  See `charts/k-shui/values-lakestream.yaml`.
- **Kubernetes (Kustomize)**: layer a `secretGenerator` + the same `${VAR}`
  pattern, or use `extraEnv`-equivalent `envFrom` in a patch.
- **Docker Compose**: use an `.env` file (gitignored) referenced via
  `${VAR}` in the compose file's `environment:` block, or Docker secrets.
- **Bare `uvx`/`npx`**: export scalar `KSHUI__*` overrides, `${VAR}` values,
  and any provider-key variable named by `apiKeyEnv` from your shell/secret
  manager rather than writing secrets into `k-shui.yaml`.

For `agent.connections[]`, `apiKeyEnv` stores only the name of the provider-key
environment variable. The administrator also chooses the provider, exact model,
and current contracted input/output rates on the server; the browser cannot
supply or override them. Restrict provider-account permissions and spend limits
outside k-shui as well as setting `agent.maxRunCostUsd` locally.

## k-shui Agent

- The agent refuses anonymous sessions and deployments with `auth.type: none`.
  Keep `agent.enabled: false` until basic or OIDC login, user roles, cluster
  grants, provider connectivity, and the configured price budget have been
  tested.
- Start in Inspect mode with `agent.allowMutations: false`. Use
  `agent.allowedClusters` and `agent.allowedTools`, plus the corresponding
  per-connection fields, to reduce scope. `allowedTools` restricts inspection
  tools; operation types use a separate built-in allowlist. These lists can
  only narrow the signed-in user's permissions; they do not grant Kafka
  authority.
- Agent evidence is bounded, timestamped metadata. Message payloads, raw
  logs/traces, credentials, and sensitive configuration values are excluded.
  Resource names and other retrieved text are still sent to the configured AI
  provider, so assess its data-processing terms for your environment. Train
  users not to paste payloads, credentials, or other secrets into prompts.
- Investigation transcripts and resource metadata persist in the k-shui
  database. Apply the same access control, encryption, backup, retention, and
  deletion policy you use for other operational records.
- If enabling `agent.allowMutations`, remember that Operate mode covers a
  smaller allowlist than the full UI. The engine rechecks the acting user's
  role and cluster access, server/cluster read-only policy, preview expiry and
  target state before dispatch; the user must review the exact preview and any
  typed confirmation. Execution results and verification are audited.
- Run one k-shui application worker/process while the agent is enabled. Current
  run admission and interrupted-run recovery do not coordinate across replicas,
  even with a shared database. `agent.maxConcurrentRuns` only limits work
  inside that process.

See [`../k-shui-agent.md`](../k-shui-agent.md) for the complete operating and
data policy.

## Network

- Terminate TLS in front of k-shui (ingress controller, load balancer, or
  reverse proxy) — the app itself serves plain HTTP.
- Set a strict `server.cors` list (default `[]`) if the SPA and API are served
  from different origins; otherwise leave it empty and let the SPA be served
  same-origin (the default, recommended setup).
- **Helm**: enable `networkPolicy.enabled: true` and scope
  `networkPolicy.ingress.from` to the namespaces/pods that should reach
  k-shui (ingress controller, other internal services). Egress is left open
  by default since k-shui talks to arbitrary per-cluster Kafka/Connect/Schema
  Registry/ksqlDB/Flink/Prometheus/Marquez endpoints — narrow it with
  `networkPolicy.extraEgress` if your environment allows enumerating those
  destinations.
- Kafka `clusters[].properties` supports full `security.protocol`/`sasl.*`/
  `ssl.*` librdkafka settings — use `SASL_SSL`/`SSL` for any non-local
  cluster, never `PLAINTEXT`.

## Container / Kubernetes posture

- The published image and the Helm chart's default `podSecurityContext`/
  `securityContext` already run as non-root (uid/gid `10001`),
  `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, and drop
  all Linux capabilities. Don't relax these unless you have a specific reason.
- Enable `persistence.enabled` (Helm) or point `database.url` at an external
  Postgres for any deployment where losing SQLite state (dashboards, alert
  history, audit log) on pod eviction is unacceptable — the default `/data`
  `emptyDir` does not survive rescheduling.
- Use `podDisruptionBudget.enabled` and `topologySpreadConstraints` (see
  `values-lakestream.yaml`) once you run more than one replica so evictions/
  node drains don't take the whole service down at once.

## Supply chain

- Verify released images: they're cosign-signed and carry an SPDX SBOM
  attestation (see `docker.md`'s "Published images" section for the
  `cosign verify` command).
- Pin image tags/chart versions in production rather than tracking `latest`.
- `dependabot.yml` keeps backend (`uv`), frontend/npm-package (`npm`), the
  Dockerfile's base images, and GitHub Actions up to date — review and merge
  those PRs promptly, especially for `confluent-kafka`/`cryptography`-adjacent
  dependencies.

## Operational hygiene

- `server.readOnly: true` (or per-cluster `clusters[].readOnly: true`) disables
  mutating operations for a cluster/deployment used only for viewing —
  consider it for any cluster non-admins can reach.
- Every mutating API call is audited (`GET /audit`); ship that log off-box in
  any compliance-sensitive environment (SQLite audit history is local and
  subject to the same persistence caveat as above).
- Rate limiting is applied to `/auth/login` — don't put k-shui's login route
  behind a proxy/WAF rule that strips or spoofs the client IP it relies on.
- Rotate `auth.jwtSecret` and any `HttpAuth`/OIDC credentials on a normal
  schedule, and immediately after any suspected exposure (e.g. a
  misconfigured ConfigMap that briefly contained plaintext secrets).
