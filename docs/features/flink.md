# Flink

## What it does

Operate Flink jobs end to end: job list and detail, execution graph,
checkpoints, exceptions, task managers, jar upload/run, savepoints, and
(where available) a SQL Gateway console — parity with the Flink Web UI, in
k-shui's design system, alongside the rest of your streaming stack.

## UI walkthrough

1. `/c/:cluster/flink` — configured Flink clusters (name, version, status,
   task manager count, slots total/available, job counts by state).
2. `/c/:cluster/flink/:fc` — cluster overview + config.
3. `/c/:cluster/flink/:fc/jobs/:jid` tabs:
   - **Overview** — state, timing, per-task-state breakdown.
   - **Graph** — the job's execution graph (vertices), same shape as the
     Flink dashboard's DAG view.
   - **Checkpoints** — history and `checkpoints/config`.
   - **Exceptions** — root/per-task exception history.
   - **Metrics** — arbitrary metric names via `get=`.
   - Per-vertex **subtasks**, **backpressure**, and **watermarks**.
   - Actions: **cancel** or **stop** (`PATCH .../jobs/{jid}?mode=`), trigger
     a **savepoint** and poll its completion.
4. `/c/:cluster/flink/:fc/taskmanagers` — list, detail, logs, metrics per
   task manager, plus job manager logs/metrics.
5. `/c/:cluster/flink/:fc/jars` — upload a jar, run it (entry class, program
   args, parallelism, optional savepoint path to restore from), delete.
6. `/c/:cluster/flink/:fc/sql` — Flink SQL Gateway console (session +
   statement submission with polled results) when `sqlGatewayUrl` is
   configured; otherwise this tab reports unsupported.

## API endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/clusters/{c}/flink` | Clusters |
| `GET` | `.../flink/{f}/overview`, `.../config` | |
| `GET` | `.../flink/{f}/jobs` | List |
| `GET` | `.../jobs/{jid}` | Detail + `vertices[]` + `plan` |
| `GET` | `.../jobs/{jid}/checkpoints`, `.../checkpoints/config`, `.../exceptions`, `.../metrics?get=` | |
| `GET` | `.../jobs/{jid}/vertices/{v}/subtasks`, `.../backpressure`, `.../watermarks` | |
| `PATCH` | `.../jobs/{jid}?mode=cancel\|stop` | |
| `POST` | `.../jobs/{jid}/savepoints` | `{targetDirectory, cancelJob}` → trigger id |
| `GET` | `.../jobs/{jid}/savepoints/{triggerId}` | Poll status |
| `GET` | `.../taskmanagers`, `.../taskmanagers/{id}`, `.../taskmanagers/{id}/logs`, `.../taskmanagers/{id}/metrics` | |
| `GET` | `.../jobmanager/logs`, `.../jobmanager/metrics` | |
| `GET` | `.../jars` | |
| `POST` | `.../jars/upload` | Multipart |
| `POST` | `.../jars/{id}/run` | `{entryClass, programArgs, parallelism, savepointPath}` |
| `DELETE` | `.../jars/{id}` | |
| `POST` | `.../sql/sessions`, `.../sql/sessions/{s}/statements` | SQL Gateway proxy |
| `GET` | `.../sql/sessions/{s}/operations/{op}/result?token` | `{supported:false}` with no gateway |

## Config required

`clusters[].flink: [{name, url, sqlGatewayUrl?, auth?}]`. `url` is the Flink
REST endpoint (JobManager); `sqlGatewayUrl` is optional and only needed for
the SQL console.

## Tips / limitations

- k-shui is a thin proxy over the Flink REST API — job submission itself
  (beyond jar-run) and cluster provisioning are out of scope; use the Flink
  Kubernetes Operator or your platform's tooling for that, and k-shui for
  day-2 operation.
- Savepoint triggers are async on the Flink side; the UI polls
  `.../savepoints/{triggerId}` until it completes or fails.
- The SQL Gateway integration needs Flink ≥ 1.16 with the gateway process
  running and reachable at `sqlGatewayUrl`; without it, `/sql` shows an
  unsupported empty state rather than erroring the whole Flink cluster page.
