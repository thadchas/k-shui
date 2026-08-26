# Kafka Connect

## What it does

Manage one or more Kafka Connect clusters: connector lifecycle, task status
and traces, plugin discovery/config validation, and a derived MirrorMaker2 /
replicator view.

## UI walkthrough

1. `/c/:cluster/connect` — configured Connect clusters (name, version,
   status, connector/running-task/failed-task counts).
2. `/c/:cluster/connect/:kc` — connector list, filterable by search/state/
   type (source/sink), each with tasks and their state/worker/trace.
3. `/c/:cluster/connect/:kc/connectors/new` — pick a plugin class, fill its
   config form (built from `PUT .../plugins/{class}/validate`, so field
   types, required-ness, importance and validation errors match Connect's
   own rules), submit.
4. `/c/:cluster/connect/:kc/connectors/:name` tabs:
   - **Overview** — status, per-task state and the connector-level trace
     when the connector itself failed.
   - **Config** — view/edit the running config as key/value pairs or JSON.
     Secret-looking keys are masked (reveal per view); edits are validated
     live against the plugin's `/validate`, and **Save & restart** shows a
     diff of what will change first.
   - **Tasks** — expand any number of stack traces (copyable); restart an
     individual task, or all failed tasks.
   - **Topics** — topics this connector reads/writes; reset the topic list.
   - **Offsets** — view and patch/reset connector offsets.
   - Actions: pause / resume / **stop** (a dialog explains that STOPPED
     releases tasks and unlocks offset editing, unlike PAUSED) / restart
     (optionally `includeTasks`, `onlyFailed`), delete (type-to-confirm).
     After any action the page polls every 2 s for 20 s so the new state
     shows up without waiting for the refresh interval. The list page
     supports bulk pause / resume / stop / restart / restart-failed / delete.
5. `/c/:cluster/connect/:kc/plugins` — installed plugin classes and versions.
6. `/c/:cluster/replication` — connectors recognized as MirrorMaker2 /
   Confluent Replicator (source→target topic mapping, lag), auto-detected
   from the Connect clusters above.

## API endpoints

| Method                 | Path                                                                      | Notes                         |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------- |
| `GET`                  | `/api/v1/clusters/{c}/connect`                                            | Connect clusters              |
| `GET`                  | `/api/v1/clusters/{c}/connect/{k}/connectors?search&state&type`           | List                          |
| `POST`                 | `/api/v1/clusters/{c}/connect/{k}/connectors`                             | `{name, config}`              |
| `GET`/`PUT`            | `.../connectors/{n}/config`                                               |                               |
| `GET`                  | `.../connectors/{n}`                                                      | Info + status + topics        |
| `DELETE`               | `.../connectors/{n}`                                                      |                               |
| `POST`                 | `.../connectors/{n}/pause\|resume\|stop\|restart?includeTasks&onlyFailed` |                               |
| `POST`                 | `.../connectors/{n}/tasks/{id}/restart`                                   |                               |
| `GET`/`PUT`            | `.../connectors/{n}/topics` / `.../topics/reset`                          |                               |
| `GET`/`PATCH`/`DELETE` | `.../connectors/{n}/offsets`                                              |                               |
| `GET`                  | `.../plugins`                                                             | `[{class, type, version}]`    |
| `PUT`                  | `.../plugins/{class}/validate`                                            | Drives the new-connector form |
| `GET`                  | `.../metrics?range=`                                                      | Prometheus-backed             |
| `GET`                  | `/api/v1/clusters/{c}/replication`                                        | MirrorMaker2/replicator view  |

## Config required

`clusters[].connect: [{name, url, auth?}]` — one entry per Connect worker
cluster (REST proxy endpoint, e.g. the Connect group's load-balanced URL).

## Tips / limitations

- The new-connector form's validation is only as good as the plugin's own
  `Validator` implementation — some connectors under-report required fields
  until you attempt to create.
- `/replication` detection is heuristic: it looks for known MirrorMaker2 /
  Replicator connector classes among configured Connect clusters. Connectors
  using a custom or forked replication class won't be classified
  automatically.
- Connect metrics need `clusters[].prometheus` with a JMX exporter scraping
  the Connect workers; without it this tab is empty.
