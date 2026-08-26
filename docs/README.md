# k-shui documentation

k-shui is an open-source, Apache-2.0 control center for Apache Kafka and its
streaming ecosystem. Start here; jump to a section below.

## Start here

- [**Getting started**](getting-started.md) — install (uv/npx/Docker/Helm),
  first config, `k-shui check`, and a tour of the UI by route.
- [**Configuration**](configuration.md) — quick config orientation, pointing
  to the full [configuration reference](deployment/configuration-reference.md).
- [**FAQ**](faq.md)

## Features

Per-area guides: what it does, a UI walkthrough, the REST endpoints behind
it, required config, and known tips/limitations.

|                                                        |                                                    |                                                       |
| ------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| [Clusters](features/clusters.md)                       | [Brokers](features/brokers.md)                     | [Topics](features/topics.md)                          |
| [Message browser](features/messages.md)                | [Consumers & share groups](features/consumers.md)  | [Schema Registry](features/schemas.md)                |
| [Kafka Connect](features/connect.md)                   | [ksqlDB](features/ksqldb.md)                       | [Flink](features/flink.md)                            |
| [Metrics](features/metrics.md)                         | [Stream lineage](features/lineage.md)              | [Alerts](features/alerts.md)                          |
| [Security](features/security.md)                       | [Settings & audit](features/settings-and-audit.md) | [Auth & RBAC](features/auth-rbac.md)                  |
| [Keyboard, URLs & accessibility](features/security.md) | [Settings & audit](features/settings-and-audit.md) | [Auth & RBAC](features/keyboard-and-accessibility.md) |

## Deployment

- [Standalone: uv / uvx](deployment/standalone-uv.md)
- [Standalone: npx](deployment/standalone-npx.md)
- [Docker](deployment/docker.md)
- [Docker Compose (full demo stack)](deployment/docker-compose.md)
- [Kubernetes: Helm](deployment/kubernetes-helm.md)
- [Kubernetes: Kustomize](deployment/kubernetes-kustomize.md)
- [Security hardening](deployment/security-hardening.md)
- [Configuration reference](deployment/configuration-reference.md) — every field, type, default, env var

## Reference

- [REST API](api.md) — auth, problem+json errors, pagination, SSE, curl examples, pointer to `/docs` Swagger
- [Comparison](comparison.md) — vs. Confluent Control Center, Kafbat UI, AKHQ, Redpanda Console
- [Architecture](architecture.md) — components, request flow, data stores, background jobs

## Project

- [Roadmap](roadmap.md)
- [Changelog](../CHANGELOG.md)
- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the source-of-truth contract (config schema, REST API, repo layout) every change codes against
- [`DESIGN.md`](../DESIGN.md) — design system (tokens, components, layout rules)
