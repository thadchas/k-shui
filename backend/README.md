# k-shui engine

The k-shui engine is the FastAPI backend for open-source, agent-driven Kafka
management. It serves the visual workspace and REST/SSE API, collects bounded
evidence for the k-shui Agent, enforces authentication and cluster policy, and
dispatches human-reviewed Agent operations. Direct resource APIs support the
broader visual workspace.

The Agent is disabled by default and requires an authenticated human user.
Inspect mode does not mutate resources. Operate mode must be enabled explicitly
and is limited to the exact topic, Kafka Connect, and consumer-offset actions in
[the k-shui Agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/). Provider credentials stay
server-side, and the current run-admission and recovery design requires one
application process.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the platform contract and
[the architecture guide](https://thadchas.github.io/k-shui-docs/next/architecture/) for the component view.

Run from this directory:

```bash
uv run k-shui serve --config ../deploy/examples/k-shui.local.yaml
```
