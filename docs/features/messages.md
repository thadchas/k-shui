# Message browser

## What it does

Browse, filter, decode, produce, and export Kafka records for a topic —
without a separate CLI tool.

## UI walkthrough

On a topic's **Messages** tab:

- Pick a starting mode: **latest**, **earliest**, a specific **offset**, or a
  **timestamp**; restrict to specific partitions.
- Toggle **live tail** (streams via SSE as new records arrive) or a bounded
  fetch (`limit`).
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
- **Export** the current filtered view as JSON, CSV, or NDJSON.

## API endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/clusters/{c}/topics/{t}/messages` | `mode=latest\|earliest\|offset\|timestamp`, `partitions`, `offset`, `timestamp`, `limit`, `keyFormat`, `valueFormat`, `filter`, `filterMode=contains\|jsonpath\|regex`, `stream=true` → SSE `message`/`progress`/`end`; `stream=false` → `{items, scanned}` |
| `POST` | `/api/v1/clusters/{c}/topics/{t}/messages` | `{partition?, key?, value, headers?, keyFormat, valueFormat, keySchemaSubject?, valueSchemaSubject?}` → `{partition, offset}` |
| `GET` | `/api/v1/clusters/{c}/topics/{t}/messages/export` | `format=json\|csv\|ndjson`, same filters — file download |

## Config required

Plain `string`/`json`/`base64`/`hex`/`int`/`long` decoding needs nothing
extra. `avro`, `protobuf`, and `jsonschema` decoding require
`clusters[].schemaRegistry` (any of Confluent/Apicurio/Karapace, since decode
goes through the `ccompat` API).

## Tips / limitations

- **Protobuf decode limits**: the Confluent wire header (magic byte, schema
  id, message-index varints) is always parsed correctly. Decoding the
  message *body* requires compiling the registry's `.proto` source on the
  fly; when that isn't possible (missing/unresolvable imports, unsupported
  proto features) k-shui returns a structured placeholder for that field
  rather than failing the whole browse — the rest of the batch still
  renders.
- Live tail with a broad filter on a high-throughput topic scans a lot of
  records; narrow the partition set or use `stream=false` with a `limit` for
  a quicker, bounded look.
- Producing with `keySchemaSubject`/`valueSchemaSubject` registers against
  that subject's current compatibility rules — an incompatible payload is
  rejected with a `problem+json` error, not a partial write.
