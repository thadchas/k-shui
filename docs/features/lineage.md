# Stream lineage

## What it does

A navigable graph of how data flows through your streaming stack: topics,
connectors, ksqlDB queries, Flink jobs, consumer groups, producers, and
OpenLineage datasets/jobs — merged from Marquez (when configured) with edges
k-shui derives itself from Connect/ksqlDB/Flink/consumer-group state.

## UI walkthrough

1. `/c/:cluster/lineage` — a graph canvas (React Flow, dagre auto-layout,
   minimap, pan/zoom controls). Each node is typed (topic, connector,
   flinkJob, ksqlQuery, consumerGroup, producer, dataset, job, schema) with
   an icon, namespace pill, and status dot.
2. Click a node to open a side panel: detail, latest runs (for
   Marquez-backed jobs), schema, and OpenLineage facets.
3. Search for a node by name; **focus** a node to re-center the graph and
   control traversal depth.
4. Toggle which lineage **sources** contribute edges (`marquez`, `connect`,
   `flink`, `ksql`, `consumers`) to declutter the view.

## API endpoints

| Method | Path                                                                                                        | Notes                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/clusters/{c}/lineage/graph?focus=&depth=&sources=`                                                 | `{nodes, edges}`                                                                   |
| `GET`  | `/api/v1/clusters/{c}/lineage/nodes/{id}`                                                                   | Detail: `latestRuns`, schema, facets                                               |
| `GET`  | `/api/v1/clusters/{c}/lineage/search?q`                                                                     |                                                                                    |
| `GET`  | `/api/v1/clusters/{c}/lineage/namespaces`, `.../datasets?namespace`, `.../jobs?namespace`, `.../runs?jobId` | Marquez passthrough                                                                |
| `POST` | `/api/v1/lineage/openlineage`                                                                               | OpenLineage event ingest — forwarded to Marquez if configured, else stored locally |

## Config required

- **Derived edges** (Connect connector→topics, topics→consumer groups, ksql
  streams, Flink job heuristics) need only the corresponding integration
  configured (`connect`, `ksqldb`, `flink`) — no extra lineage config.
- **Marquez-backed job/dataset/run history** needs
  `clusters[].lineage: {type: marquez, url, namespaces?}`.
- Set `clusters[].lineage: {type: none}` to disable Marquez calls entirely
  and rely only on derived edges.

## Tips / limitations

- Flink job lineage without a Marquez-emitting job (e.g. via Flink's
  OpenLineage listener) falls back to name/vertex heuristics matching job
  names against known topic patterns — it can miss jobs with generic names
  or produce false-positive edges; prefer wiring OpenLineage emission from
  Flink/Spark/dbt jobs into `POST /api/v1/lineage/openlineage` (or directly
  into Marquez) for accurate provenance.
- Large graphs (`depth` beyond ~3-4 hops on a busy cluster) get visually
  dense fast — use `focus` + a smaller `depth`, or narrow `sources`, rather
  than rendering the whole cluster at once.
- `namespaces` filters which Marquez namespaces contribute nodes; leave it
  empty to include all.
