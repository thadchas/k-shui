# ksqlDB

## What it does

A SQL editor against one or more ksqlDB servers, with streaming query
results, object browsers for streams/tables/queries, and per-user statement
history.

## UI walkthrough

1. `/c/:cluster/ksql` — pick a ksqlDB server (name, version, status, service
   id) if more than one is configured.
2. **Editor** tab — write a `SELECT`/`CREATE STREAM`/`CREATE TABLE`/etc.,
   run it; `SELECT` streams rows live into a results table as they arrive
   (Monaco editor, SQL syntax highlighting). The editor labels a query as
   **push (unbounded)** (`EMIT CHANGES`, or no key predicate) or **pull**;
   results are kept in an adjustable ring buffer (500 / 2 000 / 10 000 rows)
   and the grid says _showing last N of M received_ when older rows were
   evicted. **Stop** closes the transient query on the server
   (`/close-query`), not just the browser connection.
3. **Streams** / **Tables** / **Queries** tabs — object lists; click a
   stream/table for `DESCRIBE EXTENDED` output (schema, topic, serde,
   partitions, write queries).
4. Terminate a persistent query from the **Queries** tab.
5. **History** — saved and recently-run statements (server-side per user,
   merged with browser-local recents with timestamps). Viewers can run
   `SELECT`/`SHOW`/`DESCRIBE`; other statements require the editor role.

## API endpoints

| Method   | Path                                       | Notes                                                  |
| -------- | ------------------------------------------ | ------------------------------------------------------ |
| `GET`    | `/api/v1/clusters/{c}/ksql`                | Servers                                                |
| `POST`   | `/api/v1/clusters/{c}/ksql/{k}/query`      | `{sql, properties}` → SSE `header`/`row`/`error`/`end` |
| `POST`   | `/api/v1/clusters/{c}/ksql/{k}/statement`  | `{sql, properties}` — non-streaming (DDL/one-shot)     |
| `GET`    | `.../streams`, `.../tables`, `.../queries` | Object lists                                           |
| `DELETE` | `.../queries/{id}`                         | `TERMINATE`                                            |
| `GET`    | `.../streams/{name}`                       | `DESCRIBE EXTENDED`                                    |
| `GET`    | `/api/v1/clusters/{c}/ksql/{k}/history`    | Saved/recent statements (SQLite)                       |

## Config required

`clusters[].ksqldb: [{name, url, auth?}]`.

## Tips / limitations

- Streaming `SELECT` results hold the SSE connection open for the query's
  lifetime — closing the browser tab / navigating away terminates the pull
  or push query on the server.
- Statement history is stored locally in k-shui's own database (SQLite by
  default), scoped per authenticated user; with `auth.type: none` all
  history is shared under a single anonymous identity.
- Persistent query termination is immediate and not undoable — recreate the
  `CREATE STREAM/TABLE ... AS SELECT` statement to restart it.
