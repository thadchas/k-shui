# Security Policy

## Supported versions

k-shui is pre-1.0 (`0.x`). Security fixes are released against the latest `0.x`
minor release only; there is no separate LTS branch yet.

| Version | Supported |
|---------|-----------|
| latest 0.x | ✅ |
| < latest 0.x | ❌ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/k-shui/k-shui/security/advisories/new)
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

In scope: the `backend/` API and auth/session handling, the `frontend/` SPA,
the published Docker image (`deploy/docker/Dockerfile`), the Helm chart
(`charts/k-shui/`), the npm launcher (`packages/npm/`), and the GitHub Actions
release pipeline (`.github/workflows/release.yml`) that publishes those
artifacts.

Out of scope: vulnerabilities in upstream services k-shui merely talks to
(Kafka, Kafka Connect, Schema Registry, ksqlDB, Flink, Prometheus, Marquez) —
please report those to their respective projects.

## Hardening guidance

See `docs/deployment/security-hardening.md` for recommended production
settings: enabling `auth`, running behind TLS, restricting the container's
`NetworkPolicy`, keeping credentials in Kubernetes Secrets rather than the
rendered ConfigMap (`${VAR}` expansion — see `backend/k_shui/config.py`), and
verifying release artifact signatures (cosign) and SBOM attestations.
