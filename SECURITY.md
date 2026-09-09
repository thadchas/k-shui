# Security Policy

## Supported versions

k-shui is pre-1.0 (`0.x`). Security fixes are released against the latest `0.x`
minor release only; there is no separate LTS branch yet.

| Version      | Supported |
| ------------ | --------- |
| latest 0.x   | ✅        |
| < latest 0.x | ❌        |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/thadchas/k-shui/security/advisories/new)
for this repository. If that's not accessible to you, email the maintainers at
the address listed in the repository's GitHub profile.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal `k-shui.yaml` / request sequence if applicable).
- The k-shui version, deployment method (PyPI/uvx, npm, Docker image, Helm
  chart) and any relevant environment details.

We aim to acknowledge reports within 5 business days and to ship a fix or
mitigation within 90 days of confirming a valid report, coordinating disclosure
timing with the reporter.

## Scope

In scope: the k-shui Agent and engine, the `backend/` API and auth/session
handling, the `frontend/` visual workspace, the published Docker image
(`deploy/docker/Dockerfile`), the Helm chart
(`charts/k-shui/`), the npm launcher (`packages/npm/`), and the GitHub Actions
release pipeline (`.github/workflows/release-please.yml` and
`.github/workflows/release.yml`) that versions, tags and publishes those
artifacts.

Out of scope: vulnerabilities in upstream services k-shui merely talks to
(Kafka, Kafka Connect, Schema Registry, ksqlDB, Flink, Prometheus, Marquez) —
please report those to their respective projects.

## RBAC model

Management reads require the `viewer` role, mutations require `editor`, and
user management requires `admin` when authentication is enabled. This includes
the integration proxies (Schema Registry, Connect, ksqlDB, Flink, lineage
ingest, metrics dashboards). Public authentication/bootstrap and Agent status
routes have their documented narrower behavior. The UI mirrors access rules by
disabling controls, but enforcement is server-side. Connector configuration
values that look like secrets are masked before they reach the browser's
editors and are never written back from a masked state.

## Agent security boundary

The k-shui Agent is disabled by default. Enabling it does not bypass k-shui's
identity or authorization model: `auth.type: none` cannot use the Agent, every
tool call refreshes the initiating human's current role and cluster grants, and
Operate mode also requires an editor, `agent.allowMutations: true`, and a
writable server and cluster.

Provider credentials are deployment-managed environment references and are
never accepted from or returned to the browser. Evidence tools return bounded, redacted metadata from nine allowlisted tools.
Questions and conversation context also reach the configured provider; users
should not enter secrets or sensitive payloads. Message payloads, raw connector
traces, arbitrary URLs, SQL, logs, and shell tools are excluded; retrieved
resource text is treated as untrusted data rather than instructions.

Model tool calls can prepare an operation but cannot execute it. The engine
binds each five-minute preview to the user, investigation, cluster, exact target
and parameters, and observed resource state. A human reviews that preview and
supplies typed confirmation for consequential actions. The engine rechecks
authority and state, durably claims dispatch, verifies the result, and writes
audit evidence. Supported mutations are limited to the topic, connector, and
consumer-offset actions in [the k-shui Agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/).

Run an Agent-enabled deployment in one application process. Current run
admission and interrupted-run recovery are process-local; a shared database
does not make independently starting Agent workers supported.

## Hardening guidance

See [the security-hardening guide](https://thadchas.github.io/k-shui-docs/next/deployment/security-hardening/)
for recommended production
settings: enabling `auth`, running behind TLS, restricting the container's
`NetworkPolicy`, keeping credentials in Kubernetes Secrets rather than the
rendered ConfigMap (`${VAR}` expansion — see `backend/k_shui/config.py`), and
verifying release artifact signatures (cosign) and SBOM attestations. Keep
Agent provider keys in the same server-side secret mechanism, configure
explicit model pricing limits, and validate the chosen provider/model and an
isolated Kafka environment before enabling operations.
