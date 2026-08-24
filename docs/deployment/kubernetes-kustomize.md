# Kubernetes: Kustomize

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
