# Kubernetes: Helm

`charts/k-shui/` is a standard Helm v2-apiVersion chart. See
`charts/k-shui/README.md` for the full values table — this page covers the
common workflows.

## Install

```bash
helm upgrade --install k-shui charts/k-shui \
  --namespace k-shui --create-namespace \
  -f my-values.yaml
```

`charts/k-shui/values-lakestream.yaml` is a worked example against a
Strimzi-managed `lakestream` Kafka cluster plus Connect/Apicurio/Flink/
Prometheus/Marquez, each in their own namespace — copy it as a starting point:

```bash
helm upgrade --install k-shui charts/k-shui \
  --namespace k-shui --create-namespace \
  -f charts/k-shui/values-lakestream.yaml
```

Once published, it's also available as an OCI chart from GHCR:

```bash
helm install k-shui oci://ghcr.io/<owner>/charts/k-shui --version <x.y.z>
```

## What it deploys

| Resource                                                         | Always created?                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Deployment                                                       | yes                                                                                                    |
| Service                                                          | yes                                                                                                    |
| ConfigMap (rendered `values.config` → `/etc/k-shui/config.yaml`) | yes                                                                                                    |
| ServiceAccount                                                   | if `serviceAccount.create` (default `true`)                                                            |
| Ingress                                                          | if `ingress.enabled`                                                                                   |
| HorizontalPodAutoscaler                                          | if `autoscaling.enabled`                                                                               |
| PodDisruptionBudget                                              | if `podDisruptionBudget.enabled`                                                                       |
| NetworkPolicy                                                    | if `networkPolicy.enabled`                                                                             |
| PersistentVolumeClaim                                            | if `persistence.enabled` and no `persistence.existingClaim`                                            |
| ServiceMonitor / PodMonitor                                      | if `metrics.serviceMonitor.enabled` / `metrics.podMonitor.enabled` (prometheus-operator CRDs required) |

The Deployment runs as non-root (uid/gid `10001`) with
`readOnlyRootFilesystem: true`. The SQLite database path
(`config.database.url`, default `sqlite+aiosqlite:////data/k-shui.db`) and
`/tmp` are backed by an `emptyDir` — mounted at `/data` — so the container
stays writable there; enable `persistence.enabled` for state that survives pod
restarts, or point `config.database.url` at an external Postgres.

## Configuring k-shui

Set `.Values.config` to a YAML tree matching the schema in
`configuration-reference.md` / `../../ARCHITECTURE.md`. It's rendered verbatim
into the ConfigMap. **Never put real secrets there** — use `${VAR}` /
`${VAR:-default}` placeholders (k-shui's YAML loader expands them from the
process environment) and set `existingSecret: <name>` to a Kubernetes Secret
whose keys are injected as env vars via `envFrom`:

```bash
kubectl create secret generic k-shui-credentials -n k-shui \
  --from-literal=OIDC_CLIENT_SECRET=...
```

```yaml
existingSecret: k-shui-credentials
config:
  auth:
    type: oidc
    oidc:
      clientSecret: "${OIDC_CLIENT_SECRET}"
```

`extraEnv` also supports direct `KSHUI__<SECTION>__<KEY>` overrides for scalar
fields without touching `config` at all.

## Ingress under a sub-path

Set `config.server.basePath` to the same prefix as your Ingress path (e.g.
`/k-shui`) so the SPA and API routes agree, then configure `ingress.hosts` and
any rewrite annotation your controller needs.

## Validating

```bash
helm lint charts/k-shui
helm template t charts/k-shui
helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml
# or: make helm-lint / make helm-template
```

## Upgrading / uninstalling

```bash
helm upgrade k-shui charts/k-shui -f my-values.yaml
helm uninstall k-shui -n k-shui
```

A ConfigMap checksum annotation on the pod template triggers a rolling
restart automatically whenever `config` changes.
