# k-shui documentation

**Open-source, agent-driven Kafka management.** Use **k-shui Agent** to
investigate your Kafka ecosystem, explain evidence, and prepare supported
changes for review. The **k-shui engine** enforces permissions and records
execution outcomes. Resource pages and dashboards support the same workflow.

## Start with the agent

1. [Get started](getting-started.md): launch the application and connect a cluster.
2. [Enable k-shui Agent](k-shui-agent.md#deployment): configure authentication,
   an AI connection, usage rates, and allowed scope. Agent access is off by default.
3. [Run an investigation](k-shui-agent.md#investigations): ask a question in
   Inspect mode and review the evidence.
4. [Review a supported operation](k-shui-agent.md#operations): enable operations
   only when needed, inspect the exact preview, complete typed confirmation where
   required, choose **Execute**, and check the recorded outcome.

[Product architecture](architecture.md) · [Configuration](configuration.md) · [FAQ](faq.md)

## Explore the supporting workspace

These guides cover the full application. Each explains how the feature supports
agent investigations and which actions remain in the visual workspace. A page's
REST endpoints are not automatically tools available to the agent.

| Operations                                        | Streaming                              | Evidence and control                               |
| ------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| [Clusters](features/clusters.md)                  | [Kafka Connect](features/connect.md)   | [Metrics](features/metrics.md)                     |
| [Brokers](features/brokers.md)                    | [Schema Registry](features/schemas.md) | [Stream lineage](features/lineage.md)              |
| [Topics](features/topics.md)                      | [ksqlDB](features/ksqldb.md)           | [Alerts](features/alerts.md)                       |
| [Consumers & share groups](features/consumers.md) | [Flink](features/flink.md)             | [Settings & audit](features/settings-and-audit.md) |
| [Message browser](features/messages.md)           | [Security](features/security.md)       | [Auth & RBAC](features/auth-rbac.md)               |

[Keyboard, URLs & accessibility](features/keyboard-and-accessibility.md)

## Deploy and configure

- [Docker Compose](deployment/docker-compose.md): the demo stack, built from source
- [Docker](deployment/docker.md): build the image locally; the registry image is
  [publication pending](https://github.com/thadchas/k-shui/issues/59)
- [Standalone: uv / uvx](deployment/standalone-uv.md): package publication pending; runs a locally built wheel
- [Standalone: npx](deployment/standalone-npx.md): package publication pending
- [Kubernetes: Helm](deployment/kubernetes-helm.md): in-repo chart; OCI chart publication pending
- [Kubernetes: Kustomize](deployment/kubernetes-kustomize.md)
- [Agent deployment and single-process requirement](k-shui-agent.md#deployment)
- [Security hardening](deployment/security-hardening.md)
- [Configuration reference](deployment/configuration-reference.md)
- [AWS demo decision record](aws-demo-architecture-and-cost.md): architecture,
  dated cost assumptions, and outstanding integration gates

## Reference and contribution

- [Agent capabilities and boundaries](k-shui-agent.md)
- [REST API](api.md)
- [Architecture](architecture.md)
- [Comparison](comparison.md)
- [Contributing](../CONTRIBUTING.md)
- [Releasing](development/releasing.md)
- [Platform contract](../ARCHITECTURE.md)
- [Design system](../DESIGN.md)
- [Brand and product messaging](brand/README.md)

## Product direction and project policies

- [Roadmap](roadmap.md)
- [Product improvement direction](product-improvement-plan.md)
- [Documentation alignment work](agent-driven-documentation-plan.md)
- [Changelog](../CHANGELOG.md)
- [Security policy](../SECURITY.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
