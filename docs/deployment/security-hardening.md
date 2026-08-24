# Security Hardening

k-shui defaults are optimized for a fast local demo, not a production
deployment. Before exposing it beyond a trusted network, review this list.

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

Never put OIDC client secrets, SMTP passwords, or `HttpAuth` credentials
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
- **Bare `uvx`/`npx`**: export `KSHUI__*` env vars from your shell/secret
  manager rather than writing them into `k-shui.yaml`.

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
