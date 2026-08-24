# Docker Compose

`deploy/compose/docker-compose.yml` is a full standalone demo stack. Run it from
the repo root.

The examples below use the `docker compose` plugin. Installs that only ship the
standalone binary (Colima, older Docker Desktop) should substitute
`docker-compose`; the `make compose-*` targets detect which one is available and
use it automatically.

## Quick start (Kafka + k-shui only)

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
# or: make compose-up
```

This starts:

- **kafka** — `apache/kafka:4.0.0`, single-node KRaft (combined broker +
  controller). Internal listener `kafka:9092`, host listener
  `localhost:29092`.
- **k-shui** — built from `deploy/docker/Dockerfile`, configured via
  `deploy/compose/k-shui.yaml` (points at the other services by their compose
  hostnames). Exposed at `http://localhost:8090`.

## Full stack

```bash
docker compose -f deploy/compose/docker-compose.yml --profile full up --build
# or: make compose-full-up
```

Adds, all on the `full` profile:

- **connect** — `cnfldemos/cp-server-connect-datagen:0.6.4-7.6.0`, Kafka
  Connect (distributed, single worker) bundled with the Confluent datagen
  connector so there's sample traffic without any license key. REST API on
  `localhost:8083`.
- **apicurio-registry** — `apicurio/apicurio-registry:3.0.6`, Confluent-compatible
  API at `/apis/ccompat/v7`, exposed on `localhost:8084`. It uses **kafkasql**
  storage against the compose broker: Apicurio 3.x removed the 2.x `mem` storage
  variant, and `APICURIO_STORAGE_KIND: mem` makes the container crash-loop with
  `No Registry storage variant defined for value mem`. kafkasql keeps the demo
  free of an extra database by reusing the broker that is already running.
- **flink-jobmanager** / **flink-taskmanager** — `flink:1.20-scala_2.12-java17`
  session cluster, REST/UI on `localhost:8081`, Prometheus reporter enabled on
  port `9249` internally.
- **kafka-exporter** — `danielqsj/kafka-exporter`, broker/topic/consumer-group
  metrics for Prometheus.
- **prometheus** — `prom/prometheus`, scrapes `k-shui:8090/metrics`,
  `kafka-exporter:9308`, and the two Flink Prometheus reporters (see
  `deploy/compose/prometheus.yml`). Exposed on `localhost:9090`.
- **marquez** / **marquez-db** — OpenLineage backend (`marquezproject/marquez`
  - `postgres:14-alpine`), API on `localhost:5000`. Also start standalone with
    `--profile lineage`.

## Profiles summary

| Profile            | Services                                               |
| ------------------ | ------------------------------------------------------ |
| _(none / default)_ | `kafka`, `k-shui`                                      |
| `full`             | everything above                                       |
| `lineage`          | `marquez`, `marquez-db` only (also included in `full`) |

```bash
docker compose -f deploy/compose/docker-compose.yml --profile lineage up kafka k-shui marquez marquez-db
```

## Pointing at an existing host cluster

`deploy/compose/docker-compose.attach.yml` runs **only** k-shui, configured via
`deploy/compose/k-shui.attach.yaml` to reach a Kafka stack already running on
the host (e.g. the `kind`-based `lakestream` cluster from
`deploy/examples/k-shui.local.yaml`) through `host.docker.internal`:

```bash
docker compose -f deploy/compose/docker-compose.attach.yml up --build
```

On Linux, `host.docker.internal` isn't defined by default; the compose file
adds it via `extra_hosts: ["host.docker.internal:host-gateway"]` (harmless on
Docker Desktop for macOS/Windows, where it already resolves).

## Validating

```bash
docker compose -f deploy/compose/docker-compose.yml config
docker compose -f deploy/compose/docker-compose.yml --profile full config
docker compose -f deploy/compose/docker-compose.attach.yml config
```

## Host port conflicts

The stack publishes `8090` (k-shui), `29092` (Kafka) and — on `full` — `8081`,
`8083`, `8084`, `9090`, `5000`/`5001`. Those overlap with the ports a
`kubectl port-forward`-based local cluster typically uses, and Compose will not
start a service whose published port is already taken. Override just the ports
with a second compose file rather than editing the stack:

```yaml
# my-ports.yml
services:
  k-shui:
    ports: !override ["8096:8090"]
  prometheus:
    ports: !override ["19090:9090"]
```

```bash
docker compose -f deploy/compose/docker-compose.yml -f my-ports.yml up -d
```

The same trick swaps in a locally built image without touching the stack file —
add `image: k-shui:dev` under the `k-shui` service and Compose reuses it instead
of building (`build:` is only invoked when the image is missing or `--build` is
passed).

The `full` profile is heavy: Connect alone holds ~2.3 GB RSS and the whole stack
comfortably exceeds 5 GB. On a memory-capped Docker VM the broker starts timing
out under that load, and k-shui reports the cluster as `offline` with a transport
error. Give the VM headroom, or run only the services you need.

## Cleaning up

```bash
docker compose -f deploy/compose/docker-compose.yml down -v
# or: make compose-down
```

`-v` also removes the `kafka-data` and `marquez-db-data` named volumes.
