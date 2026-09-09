# Alerts

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its alerting engine lets you define metric-based triggers on any component,
buffer conditions before firing, notify via email/Slack/PagerDuty/Teams/
webhook, and keep a firing/resolved history — evaluated by a background
scheduler, not the browser.

## k-shui Agent workflow

Select **Investigate** on an alert-history row to open a cluster- and
alert-scoped investigation, or use **Ask K-Shui** in the top bar for a broader
cluster question. In Inspect mode, k-shui Agent can retrieve the selected
alert's status, measured value, threshold, and firing/resolution timestamps,
then correlate them with other allowlisted metadata available in that cluster.

[The agent](../k-shui-agent.md) is disabled by default and requires an authenticated k-shui user.
Alert evidence is read-only: the agent cannot acknowledge events, edit
triggers or notification actions, send test notifications, or heal the
condition automatically. Use the alert UI and k-shui engine APIs below for
those actions.

## UI walkthrough

1. `/alerts` (app-level, spans all clusters) — three tabs:
   - **History** — firing/resolved events: severity, component, target,
     cluster, value vs. threshold, fired/resolved timestamps, per-action
     notification status; acknowledge an event.
   - **Triggers** — list, enable/disable, create (`/alerts/triggers/new`) or
     edit (`/alerts/triggers/:id`): component + target (exact name or
     regex), metric (from the catalog below), condition/threshold, a buffer
     duration the condition must hold before firing, severity, and which
     actions to invoke.
   - **Actions** — list, create (`/alerts/actions/new`) or edit: name, type
     (email/Slack/PagerDuty/webhook/Teams), type-specific config, a **Test**
     button that sends a sample notification immediately.
2. The topbar alerts bell shows a live firing count (`GET /alerts/summary`)
   and updates via the `/events` SSE stream (`alert.fired`/`alert.resolved`).

## Metric catalog (`GET /api/v1/alerts/metrics`)

| Component       | Metrics                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cluster`       | underReplicatedPartitions, offlinePartitions, activeControllerCount, zkOrKraftUnavailable, brokerDownCount, bytesIn, bytesOut |
| `broker`        | bytesIn, bytesOut, produceRequestLatency, fetchRequestLatency, diskUsagePct, isOffline                                        |
| `topic`         | underReplicated, bytesIn, bytesOut, messagesIn, sizeBytes                                                                     |
| `consumerGroup` | lag, lagPerPartition, consumptionDifference, memberCount, isEmpty                                                             |
| `connector`     | state != RUNNING, failedTasks, taskState                                                                                      |
| `ksqlQuery`     | errorRate, messagesConsumed                                                                                                   |
| `flinkJob`      | state != RUNNING, restarts, checkpointFailures, backpressure                                                                  |
| `custom`        | arbitrary PromQL expression (requires `clusters[].prometheus`)                                                                |

## API endpoints

| Method               | Path                                                                            | Notes                                    |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| `GET`/`POST`         | `/api/v1/alerts/triggers`                                                       | List/create                              |
| `GET`/`PUT`/`DELETE` | `/api/v1/alerts/triggers/{id}`                                                  |                                          |
| `POST`               | `/api/v1/alerts/triggers/{id}/enable\|disable`                                  |                                          |
| `GET`                | `/api/v1/alerts/metrics`                                                        | Catalog above                            |
| `GET`/`POST`         | `/api/v1/alerts/actions`                                                        |                                          |
| `GET`/`PUT`/`DELETE` | `/api/v1/alerts/actions/{id}`                                                   |                                          |
| `POST`               | `/api/v1/alerts/actions/{id}/test`                                              | Sends a sample notification              |
| `GET`                | `/api/v1/alerts/history?status=firing\|resolved&component&clusterId&since&page` |                                          |
| `POST`               | `/api/v1/alerts/history/{id}/ack`                                               |                                          |
| `GET`                | `/api/v1/alerts/summary`                                                        | Counts by severity/cluster, for the bell |

## Config required

- `alerts.evaluationIntervalSeconds` (default 30) controls how often the
  background asyncio task re-evaluates every enabled trigger; `historyRetentionDays`
  bounds how long fired/resolved history is kept.
- **Email** actions need `alerts.smtp: {host, port, username, password, from,
tls}`.
- **Slack** actions need an incoming webhook URL; **PagerDuty** needs an
  Events API v2 routing key; **Teams** a workflow/webhook URL; **webhook**
  any URL plus an optional payload template.
- `custom` (PromQL) triggers need `clusters[].prometheus`.

## Tips / limitations

- A trigger only fires once its condition has held continuously for
  `bufferSeconds` — this avoids alert storms from single-poll blips; expect
  up to `bufferSeconds + evaluationIntervalSeconds` of latency between a real
  condition and the first notification.
- `target.regex` on a component (e.g. all topics matching `orders-.*`)
  evaluates the metric per matching instance and fires independently per
  match, not once for the whole set.
- The engine also exports `kshui_alerts_firing{severity}` as a Prometheus
  gauge on k-shui's own `/metrics`, so you can alert on k-shui's alerts from
  an external Alertmanager too.
