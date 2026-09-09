# Kubernetes: Kustomize

The manifests deploy the agent-capable k-shui engine, while the checked-in
configs use `auth.type: none` and therefore leave k-shui Agent unavailable.

`deploy/kustomize/` is an alternative to the Helm chart for teams that prefer
plain manifests + overlays.

```
deploy/kustomize/
├── base/                 Deployment, Service, ServiceAccount, ConfigMap generator
└── overlays/
    ├── dev/               namespace k-shui-dev, 1 replica, debug logging, image tag "dev"
    └── prod/               namespace k-shui, 3 replicas, bigger resources, Ingress, pinned tag
```

## Render

```bash
kubectl kustomize deploy/kustomize/base
kubectl kustomize deploy/kustomize/overlays/dev
kubectl kustomize deploy/kustomize/overlays/prod
# or: make kustomize-dev / make kustomize-prod
```

## Apply

```bash
kubectl apply -k deploy/kustomize/overlays/dev
kubectl apply -k deploy/kustomize/overlays/prod
```

## How the overlays work

- `base/k-shui.yaml` holds the default config, consumed by a
  `configMapGenerator` (`k-shui-config`) — kustomize hashes the generated
  ConfigMap name and automatically rewrites references in the Deployment's
  volume, so config changes trigger a new ConfigMap and a rolling update.
- Each overlay ships its **own** `k-shui.yaml` and uses
  `configMapGenerator: ... behavior: replace` to swap the config wholesale
  (different clusters/log level/etc. per environment) rather than merging.
- `deployment-patch.yaml` in each overlay is a strategic-merge patch that
  adjusts `replicas`, `resources`, and `imagePullPolicy`.
- `overlays/prod/ingress.yaml` adds an Ingress resource that only exists in
  that overlay (dev is reached via port-forward or a separate ingress you add
  yourself).
- `images:` in each `kustomization.yaml` pins the image tag per environment
  (`dev`, or a specific released version for `prod`).

## Adjusting for your cluster

At minimum, edit `overlays/{dev,prod}/k-shui.yaml`'s `clusters:` entries to
point at your real Kafka/Connect/Schema-Registry/Flink/Prometheus/Marquez
service DNS names, and `overlays/prod/ingress.yaml`'s `host`/`tls` to your
domain and cert-manager issuer (or drop the Ingress and front it with your own
gateway).

See `configuration-reference.md` for the full config schema.

## Enable k-shui Agent

In the selected overlay's `k-shui.yaml`, configure basic or OIDC authentication
and an `agent` block following [`../k-shui-agent.md`](../k-shui-agent.md). Keep
the provider key out of that ConfigMap: generate a Secret from a local,
uncommitted env file and expose it to the container with `envFrom`, so the
connection's `apiKeyEnv` name resolves in the server process.

```yaml
# overlay kustomization.yaml
secretGenerator:
  - name: k-shui-credentials
    envs: [agent.env]

# deployment patch, under spec.template.spec.containers[name: k-shui]
envFrom:
  - secretRef:
      name: k-shui-credentials
```

`agent.env` can contain `KSHUI_AGENT_OPENAI_KEY`, `KSHUI_JWT_SECRET`, and other
values referenced by `${VAR}` in the YAML. Do not commit it. Start with
`agent.allowMutations: false`, apply the overlay, sign in as an admin, and test
the connection in **Settings → AI connections**.

Set the Deployment to one replica while the agent is enabled. In particular,
the checked-in prod overlay sets `replicas: 3`, so patch it to `1`; current
agent run admission and recovery require one k-shui application worker/process
even when all replicas share a database.
