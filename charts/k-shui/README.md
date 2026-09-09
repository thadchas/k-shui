# k-shui

Helm chart for [k-shui](https://github.com/thadchas/k-shui) — open-source,
agent-driven management for Apache Kafka and its streaming ecosystem (Connect,
Schema Registry, ksqlDB, Flink, Prometheus metrics and OpenLineage/Marquez
lineage). k-shui Agent investigates scoped evidence and prepares supported
changes; the k-shui engine enforces roles, executes reviewed actions, verifies
outcomes, and audits mutations.

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
[the configuration reference](https://thadchas.github.io/k-shui-docs/next/deployment/configuration-reference/)
— set `clusters`, `auth`, `database`, `telemetry`, `alerts`, etc. there.

Keep secrets out of the ConfigMap: put `${VAR}` / `${VAR:-default}` placeholders in
`config` and set `existingSecret` to a Secret whose keys are exposed to the container as
environment variables (k-shui's YAML loader expands `${VAR}` from the process
environment — see `backend/k_shui/config.py::_expand_env`). You can also override any
setting directly via `KSHUI__<SECTION>__<KEY>` env vars in `extraEnv`.

## Enabling k-shui Agent

The chart defaults to `auth.type: none` with the agent disabled. To enable the
intended agent workflow, configure `auth.type: basic` or `oidc`, add
`config.agent.enabled: true` and at least one `config.agent.connections[]`
entry, and supply the environment variable named by `apiKeyEnv` through
`existingSecret`. The provider, model ID, and both contracted USD-per-million
token rates are administrator-managed server configuration; missing pricing
prevents paid runs. Start with `allowMutations: false`, then sign in and test the
connection as an admin under **Settings → AI connections**.

Agent-enabled deployments currently require one pod/application process. Set
`replicaCount: 1` and keep `autoscaling.enabled: false`; run admission and
interrupted-run recovery do not coordinate across replicas. This constraint
also means `values-lakestream.yaml` must be overridden before adding agent
configuration because that example enables replicas and autoscaling. See
[the k-shui Agent guide](https://thadchas.github.io/k-shui-docs/next/k-shui-agent/) and
[the Helm guide](https://thadchas.github.io/k-shui-docs/next/deployment/kubernetes-helm/)
for a complete example and the operating boundaries.

## Validating

```bash
helm lint charts/k-shui
helm template t charts/k-shui -f charts/k-shui/values-lakestream.yaml
```

## Values

| Key                                                   | Type   | Default                                                        | Description                                                                                                                                                        |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `replicaCount`                                        | int    | `1`                                                            | Pod replicas (ignored when `autoscaling.enabled`).                                                                                                                 |
| `image.repository`                                    | string | `ghcr.io/thadchas/k-shui`                                      | Image repository.                                                                                                                                                  |
| `image.tag`                                           | string | `""`                                                           | Image tag; defaults to `.Chart.AppVersion`.                                                                                                                        |
| `image.pullPolicy`                                    | string | `IfNotPresent`                                                 | Image pull policy.                                                                                                                                                 |
| `imagePullSecrets`                                    | list   | `[]`                                                           | Names of existing image pull secrets.                                                                                                                              |
| `nameOverride` / `fullnameOverride`                   | string | `""`                                                           | Override generated resource names.                                                                                                                                 |
| `serviceAccount.create`                               | bool   | `true`                                                         | Create a ServiceAccount.                                                                                                                                           |
| `serviceAccount.name`                                 | string | `""`                                                           | Name of the ServiceAccount; generated when empty.                                                                                                                  |
| `serviceAccount.annotations`                          | map    | `{}`                                                           | Annotations for the ServiceAccount.                                                                                                                                |
| `serviceAccount.automountServiceAccountToken`         | bool   | `true`                                                         | Automount the SA token.                                                                                                                                            |
| `podAnnotations` / `podLabels`                        | map    | `{}`                                                           | Extra pod metadata.                                                                                                                                                |
| `podSecurityContext`                                  | map    | non-root uid/gid 10001                                         | Pod-level `securityContext`.                                                                                                                                       |
| `securityContext`                                     | map    | read-only rootfs, no priv-esc, drop ALL caps                   | Container-level `securityContext`.                                                                                                                                 |
| `service.type`                                        | string | `ClusterIP`                                                    | Service type.                                                                                                                                                      |
| `service.port`                                        | int    | `8090`                                                         | Service port.                                                                                                                                                      |
| `service.annotations`                                 | map    | `{}`                                                           | Service annotations.                                                                                                                                               |
| `ingress.enabled`                                     | bool   | `false`                                                        | Create an Ingress.                                                                                                                                                 |
| `ingress.className`                                   | string | `""`                                                           | `ingressClassName`.                                                                                                                                                |
| `ingress.annotations`                                 | map    | `{}`                                                           | Ingress annotations (rewrite rules, cert-manager, etc).                                                                                                            |
| `ingress.hosts`                                       | list   | `[{host: k-shui.local, paths: [{path: /, pathType: Prefix}]}]` | Ingress rules. When serving under a sub-path, set `config.server.basePath` to match.                                                                               |
| `ingress.tls`                                         | list   | `[]`                                                           | Ingress TLS blocks.                                                                                                                                                |
| `resources`                                           | map    | `{}`                                                           | Pod resource requests/limits.                                                                                                                                      |
| `autoscaling.enabled`                                 | bool   | `false`                                                        | Create a HorizontalPodAutoscaler.                                                                                                                                  |
| `autoscaling.minReplicas` / `maxReplicas`             | int    | `1` / `5`                                                      | HPA bounds.                                                                                                                                                        |
| `autoscaling.targetCPUUtilizationPercentage`          | int    | `75`                                                           | CPU target.                                                                                                                                                        |
| `autoscaling.targetMemoryUtilizationPercentage`       | int    | `null`                                                         | Optional memory target.                                                                                                                                            |
| `podDisruptionBudget.enabled`                         | bool   | `false`                                                        | Create a PodDisruptionBudget.                                                                                                                                      |
| `podDisruptionBudget.minAvailable` / `maxUnavailable` | int    | `1` / unset                                                    | Set exactly one.                                                                                                                                                   |
| `networkPolicy.enabled`                               | bool   | `false`                                                        | Create a NetworkPolicy (ingress restricted, egress open by default).                                                                                               |
| `networkPolicy.ingress.from`                          | list   | `[]`                                                           | `from` peers allowed to reach the Service port.                                                                                                                    |
| `networkPolicy.extraEgress`                           | list   | `[]`                                                           | Extra egress rules appended after the allow-all default.                                                                                                           |
| `nodeSelector` / `tolerations` / `affinity`           | —      | `{}` / `[]` / `{}`                                             | Standard scheduling knobs.                                                                                                                                         |
| `topologySpreadConstraints`                           | list   | `[]`                                                           | Pod topology spread.                                                                                                                                               |
| `priorityClassName`                                   | string | `""`                                                           | Pod priority class.                                                                                                                                                |
| `extraEnv`                                            | list   | `[]`                                                           | Extra `env` entries (e.g. `KSHUI__*` overrides).                                                                                                                   |
| `extraEnvFrom`                                        | list   | `[]`                                                           | Extra `envFrom` sources, appended after `existingSecret`.                                                                                                          |
| `existingSecret`                                      | string | `""`                                                           | Secret name whose keys become env vars, for `${VAR}` expansion inside `config`.                                                                                    |
| `extraVolumes` / `extraVolumeMounts`                  | list   | `[]`                                                           | Additional volumes/mounts.                                                                                                                                         |
| `persistence.enabled`                                 | bool   | `false`                                                        | Mount a PVC at `/data` for the SQLite DB instead of an `emptyDir`.                                                                                                 |
| `persistence.size`                                    | string | `1Gi`                                                          | PVC size.                                                                                                                                                          |
| `persistence.storageClassName`                        | string | `""`                                                           | StorageClass; empty uses the cluster default.                                                                                                                      |
| `persistence.existingClaim`                           | string | `""`                                                           | Use an existing PVC instead of creating one.                                                                                                                       |
| `probes.liveness` / `probes.readiness`                | map    | `/healthz` 15s/5s/6 failures, `/readyz` 10s/5s/3 failures      | Probe tuning. Liveness is intentionally slack — a stalled Kafka round-trip can block `/healthz` for tens of seconds and a tight probe restart-loops a healthy pod. |
| `metrics.serviceMonitor.enabled`                      | bool   | `false`                                                        | Create a prometheus-operator `ServiceMonitor`.                                                                                                                     |
| `metrics.podMonitor.enabled`                          | bool   | `false`                                                        | Create a prometheus-operator `PodMonitor` (use at most one of the two).                                                                                            |
| `config`                                              | map    | see `values.yaml`                                              | Rendered as `/etc/k-shui/config.yaml`.                                                                                                                             |

## Notes on `readOnlyRootFilesystem`

The container runs with `readOnlyRootFilesystem: true`. The default SQLite database path
(`config.database.url: sqlite+aiosqlite:////data/k-shui.db`) and `/tmp` are backed by an
`emptyDir` (or the PVC when `persistence.enabled`) mounted at `/data`, so state survives
container restarts only when persistence is enabled — otherwise it is lost on
reschedule. Point `config.database.url` at an external Postgres for durable multi-replica
state.
