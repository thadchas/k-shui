# Message browser

## What it does

Browse, filter, decode, produce, and export Kafka records for a topic —
without a separate CLI tool.

## UI walkthrough

On a topic's **Messages** tab:

- Pick a starting mode: **latest**, **earliest**, a specific **offset**, a
  **timestamp**, or **live tail**; restrict to specific partitions. In offset
  mode the input shows the selected partitions' begin/end offsets and clamps
  out-of-range values; expand **per-partition offsets** to seek each partition
  independently (`startOffsets`).
- **Live tail** follows the topic until you stop it: a pulsing _live_ pill,
  _caught up_ / _N behind_ from server heartbeats, **Pause** (new records are
  buffered, resume flushes them), a _jump to latest_ button when you scroll
  away, and a **follow key** chip (click any key) that narrows the tail to
  that exact key.
- Filter **target**: anywhere, key, value, or headers. `header:trace=abc`
  matches a header by name; `header:trace` alone tests presence.
- **Tombstones** (keyed record, null value) get a badge; compacted topics
  offer a _hide tombstones_ toggle.
- Timestamps render in **local**, **UTC**, or **epoch** (remembered per
  browser). `⌘/Ctrl+Enter` runs the fetch; each row's menu copies key, value,
  or offset.
- Key/value format per side: `auto`, `string`, `json`, `avro`, `protobuf`,
  `jsonschema`, `base64`, `hex`, `int`, `long`. `auto` inspects the Confluent
  wire-format magic byte and falls back to registry lookup, then JSON, then
  string.
- Filter by substring, JSONPath, or regex, applied against the decoded value
  as records stream in — a progress indicator shows scanned/matched/done.
- Click a row to open the raw key/value/headers in a JSON viewer, with a copy
  button.
- **Produce** a new message: key, value, optional headers, per-side format,
  and (for Avro/JSON Schema) the registry subject to encode against.
- **Export** the current filtered view as JSON, CSV, or NDJSON — from the
  on-screen buffer when the fetch is complete or tailing, otherwise re-queried
  server-side with the same filters.

## API endpoints

| Method | Path                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/clusters/{c}/topics/{t}/messages`        | `mode=latest\|earliest\|offset\|timestamp\|tail`, `partitions`, `offset`, `startOffsets=p:o,…`, `timestamp`, `limit`, `keyFormat`, `valueFormat`, `filter`, `filterMode=contains\|jsonpath\|regex`, `filterTarget=any\|key\|value\|header`, `stream=true` → SSE `message`/`progress`/`end`; `stream=false` → `{items, scanned}`. `tail` never ends and sends a `progress` heartbeat (`behind`, `endOffsets`, `positions`) every ~2 s |
| `POST` | `/api/v1/clusters/{c}/topics/{t}/messages`        | `{partition?, key?, value, headers?, keyFormat, valueFormat, keySchemaSubject?, valueSchemaSubject?}` → `{partition, offset}`                                                                                                                                                                                                                                                                                                        |
| `GET`  | `/api/v1/clusters/{c}/topics/{t}/messages/export` | `format=json\|csv\|ndjson`, same filters — file download                                                                                                                                                                                                                                                                                                                                                                             |

## Config required

Plain `string`/`json`/`base64`/`hex`/`int`/`long` decoding needs nothing
extra. `avro`, `protobuf`, and `jsonschema` decoding require
`clusters[].schemaRegistry` (any of Confluent/Apicurio/Karapace, since decode
goes through the `ccompat` API).

## Tips / limitations

- **Protobuf decode limits**: the Confluent wire header (magic byte, schema
  id, message-index varints) is always parsed correctly. Decoding the
  message _body_ requires compiling the registry's `.proto` source on the
  fly; when that isn't possible (missing/unresolvable imports, unsupported
  proto features) k-shui returns a structured placeholder for that field
  rather than failing the whole browse — the rest of the batch still
  renders.
- Live tail keeps only the newest `limit` records in the browser (oldest are
  evicted); pausing buffers up to the same bound. A broad filter on a
  high-throughput topic scans a lot of records — narrow the partition set,
  follow a key, or use `stream=false` with a `limit` for a bounded look.
- Producing with `keySchemaSubject`/`valueSchemaSubject` registers against
  that subject's current compatibility rules — an incompatible payload is
  rejected with a `problem+json` error, not a partial write.
