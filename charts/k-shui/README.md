# k-shui

Helm chart for [k-shui](https://github.com/k-shui/k-shui) — an open-source control center
for Apache Kafka and its streaming ecosystem (Connect, Schema Registry, ksqlDB, Flink,
Prometheus metrics and OpenLineage/Marquez lineage) in a single UI.

## Installing

```bash
helm upgrade --install k-shui charts/k-shui \
  --namespace k-shui --create-namespace \
  -f my-values.yaml
```

See `values-lakestream.yaml` for a worked example pointing at a Strimzi-managed cluster
plus Connect/Apicurio/Flink/Prometheus/Marquez, with ingress, autoscaling, PDB,
NetworkPolicy, persistence and a ServiceMonitor all turned on.

## Configuring k-shui itself

The chart renders `.Values.config` as YAML into a ConfigMap mounted at
`/etc/k-shui/config.yaml`. Its schema is documented in `../../ARCHITECTURE.md` and
`../../docs/deployment/configuration-reference.md` — set `clusters`, `auth`, `database`,
`telemetry`, `alerts`, etc. there.

Keep secrets out of the ConfigMap: put `${VAR}` / `${VAR:-default}` placeholders in
`config` and set `existingSecret` to a Secret whose keys are exposed to the container as
environment variables (k-shui's YAML loader expands `${VAR}` from the process
environment — see `backend/k_shui/config.py::_expand_env`). You can also override any
setting directly via `KSHUI__<SECTION>__<KEY>` env vars in `extraEnv`.

## Validating

```bash
helm lint charts/k-shui
helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml
```

## Values

| Key                                                   | Type   | Default                                                        | Description                                                                          |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `replicaCount`                                        | int    | `1`                                                            | Pod replicas (ignored when `autoscaling.enabled`).                                   |
| `image.repository`                                    | string | `ghcr.io/k-shui/k-shui`                                        | Image repository.                                                                    |
| `image.tag`                                           | string | `""`                                                           | Image tag; defaults to `.Chart.AppVersion`.                                          |
| `image.pullPolicy`                                    | string | `IfNotPresent`                                                 | Image pull policy.                                                                   |
| `imagePullSecrets`                                    | list   | `[]`                                                           | Names of existing image pull secrets.                                                |
| `nameOverride` / `fullnameOverride`                   | string | `""`                                                           | Override generated resource names.                                                   |
| `serviceAccount.create`                               | bool   | `true`                                                         | Create a ServiceAccount.                                                             |
| `serviceAccount.name`                                 | string | `""`                                                           | Name of the ServiceAccount; generated when empty.                                    |
| `serviceAccount.annotations`                          | map    | `{}`                                                           | Annotations for the ServiceAccount.                                                  |
| `serviceAccount.automountServiceAccountToken`         | bool   | `true`                                                         | Automount the SA token.                                                              |
| `podAnnotations` / `podLabels`                        | map    | `{}`                                                           | Extra pod metadata.                                                                  |
| `podSecurityContext`                                  | map    | non-root uid/gid 10001                                         | Pod-level `securityContext`.                                                         |
| `securityContext`                                     | map    | read-only rootfs, no priv-esc, drop ALL caps                   | Container-level `securityContext`.                                                   |
| `service.type`                                        | string | `ClusterIP`                                                    | Service type.                                                                        |
| `service.port`                                        | int    | `8090`                                                         | Service port.                                                                        |
| `service.annotations`                                 | map    | `{}`                                                           | Service annotations.                                                                 |
| `ingress.enabled`                                     | bool   | `false`                                                        | Create an Ingress.                                                                   |
| `ingress.className`                                   | string | `""`                                                           | `ingressClassName`.                                                                  |
| `ingress.annotations`                                 | map    | `{}`                                                           | Ingress annotations (rewrite rules, cert-manager, etc).                              |
| `ingress.hosts`                                       | list   | `[{host: k-shui.local, paths: [{path: /, pathType: Prefix}]}]` | Ingress rules. When serving under a sub-path, set `config.server.basePath` to match. |
| `ingress.tls`                                         | list   | `[]`                                                           | Ingress TLS blocks.                                                                  |
| `resources`                                           | map    | `{}`                                                           | Pod resource requests/limits.                                                        |
| `autoscaling.enabled`                                 | bool   | `false`                                                        | Create a HorizontalPodAutoscaler.                                                    |
| `autoscaling.minReplicas` / `maxReplicas`             | int    | `1` / `5`                                                      | HPA bounds.                                                                          |
| `autoscaling.targetCPUUtilizationPercentage`          | int    | `75`                                                           | CPU target.                                                                          |
| `autoscaling.targetMemoryUtilizationPercentage`       | int    | `null`                                                         | Optional memory target.                                                              |
| `podDisruptionBudget.enabled`                         | bool   | `false`                                                        | Create a PodDisruptionBudget.                                                        |
| `podDisruptionBudget.minAvailable` / `maxUnavailable` | int    | `1` / unset                                                    | Set exactly one.                                                                     |
| `networkPolicy.enabled`                               | bool   | `false`                                                        | Create a NetworkPolicy (ingress restricted, egress open by default).                 |
| `networkPolicy.ingress.from`                          | list   | `[]`                                                           | `from` peers allowed to reach the Service port.                                      |
| `networkPolicy.extraEgress`                           | list   | `[]`                                                           | Extra egress rules appended after the allow-all default.                             |
| `nodeSelector` / `tolerations` / `affinity`           | —      | `{}` / `[]` / `{}`                                             | Standard scheduling knobs.                                                           |
| `topologySpreadConstraints`                           | list   | `[]`                                                           | Pod topology spread.                                                                 |
| `priorityClassName`                                   | string | `""`                                                           | Pod priority class.                                                                  |
| `extraEnv`                                            | list   | `[]`                                                           | Extra `env` entries (e.g. `KSHUI__*` overrides).                                     |
| `extraEnvFrom`                                        | list   | `[]`                                                           | Extra `envFrom` sources, appended after `existingSecret`.                            |
| `existingSecret`                                      | string | `""`                                                           | Secret name whose keys become env vars, for `${VAR}` expansion inside `config`.      |
| `extraVolumes` / `extraVolumeMounts`                  | list   | `[]`                                                           | Additional volumes/mounts.                                                           |
| `persistence.enabled`                                 | bool   | `false`                                                        | Mount a PVC at `/data` for the SQLite DB instead of an `emptyDir`.                   |
| `persistence.size`                                    | string | `1Gi`                                                          | PVC size.                                                                            |
| `persistence.storageClassName`                        | string | `""`                                                           | StorageClass; empty uses the cluster default.                                        |
| `persistence.existingClaim`                           | string | `""`                                                           | Use an existing PVC instead of creating one.                                         |
| `probes.liveness` / `probes.readiness`                | map    | `/healthz` 15s/5s/6 failures, `/readyz` 10s/5s/3 failures      | Probe tuning. Liveness is intentionally slack — a stalled Kafka round-trip can block `/healthz` for tens of seconds and a tight probe restart-loops a healthy pod. |
| `metrics.serviceMonitor.enabled`                      | bool   | `false`                                                        | Create a prometheus-operator `ServiceMonitor`.                                       |
| `metrics.podMonitor.enabled`                          | bool   | `false`                                                        | Create a prometheus-operator `PodMonitor` (use at most one of the two).              |
| `config`                                              | map    | see `values.yaml`                                              | Rendered as `/etc/k-shui/config.yaml`.                                               |

## Notes on `readOnlyRootFilesystem`

The container runs with `readOnlyRootFilesystem: true`. The default SQLite database path
(`config.database.url: sqlite+aiosqlite:////data/k-shui.db`) and `/tmp` are backed by an
`emptyDir` (or the PVC when `persistence.enabled`) mounted at `/data`, so state survives
container restarts only when persistence is enabled — otherwise it is lost on
reschedule. Point `config.database.url` at an external Postgres for durable multi-replica
state.
