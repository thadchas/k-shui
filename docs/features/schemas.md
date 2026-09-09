# Schema Registry

## What it does

k-shui provides open-source, agent-driven Kafka management across the
streaming ecosystem. Its governance workspace browses, creates, and evolves
schemas against any `ccompat`-speaking registry: Confluent Schema Registry,
Apicurio Registry, or Karapace.

## k-shui Agent workflow

Use **Ask K-Shui** with the relevant cluster and subject name. Inspect mode
can retrieve the latest schema id, version, type, field names/types, default
presence, and effective compatibility policy. Schema source, descriptions,
default values, references, and compatibility error text are excluded from
agent evidence.

[k-shui Agent](../k-shui-agent.md) is disabled by default and requires an
authenticated k-shui user.

This summary cannot determine whether a candidate schema is compatible because
the agent accepts no candidate schema. Registration, compatibility checks,
configuration changes, and deletion remain visual workspace and direct k-shui engine APIs workflows;
Operate mode currently has no schema mutation.

## UI walkthrough

1. `/c/:cluster/schemas` — subjects list: latest version, schema type
   (Avro/Protobuf/JSON Schema), compatibility mode, version count, linked
   topic when inferable. Search and filter (including soft-deleted subjects).
2. `/c/:cluster/schemas/new` — register a new subject: schema source (paste
   or upload), type, references, compatibility mode, with a normalize option.
3. `/c/:cluster/schemas/:subject`:
   - **Versions** — every version with its schema id and content; _Show
     deleted_ reveals soft-deleted versions. Each version can be soft-deleted
     or (after that) deleted permanently.
   - **Diff** — unified diff between any two versions.
   - **Compatibility** — check a candidate schema (any type, with the
     subject's references and optional `normalize`) against the subject's
     current mode before registering it for real. _New version_ carries the
     existing references and type into the register form.
   - Per-subject compatibility override, or **inherited** to drop the
     override and follow the registry's global default.
   - **Delete** a version, or the whole subject (soft or `permanent`).

## API endpoints

| Method      | Path                                                                       | Notes                                                                               |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET`       | `/api/v1/clusters/{c}/schemas/subjects?search&deleted`                     | List                                                                                |
| `GET`       | `/api/v1/clusters/{c}/schemas/subjects/{s}`                                | Versions                                                                            |
| `GET`       | `/api/v1/clusters/{c}/schemas/subjects/{s}/versions/{v}`                   | One version                                                                         |
| `POST`      | `/api/v1/clusters/{c}/schemas/subjects/{s}/versions`                       | `{schema, schemaType, references, normalize}`                                       |
| `DELETE`    | `/api/v1/clusters/{c}/schemas/subjects/{s}?permanent` / `.../versions/{v}` |                                                                                     |
| `GET`/`PUT` | `/api/v1/clusters/{c}/schemas/subjects/{s}/config`                         | `{compatibility}`                                                                   |
| `GET`/`PUT` | `/api/v1/clusters/{c}/schemas/config`                                      | Global compatibility default                                                        |
| `POST`      | `/api/v1/clusters/{c}/schemas/subjects/{s}/compatibility`                  | `{schema, schemaType}` → `{isCompatible, messages}`                                 |
| `GET`       | `/api/v1/clusters/{c}/schemas/subjects/{s}/diff?from=&to=`                 | `{unifiedDiff}`                                                                     |
| `GET`       | `/api/v1/clusters/{c}/schemas/ids/{id}`                                    | Lookup by global schema id                                                          |
| `GET`       | `/api/v1/clusters/{c}/schemas/info`                                        | `{type, url, mode, version}` — which registry implementation is behind this cluster |

## Config required

`clusters[].schemaRegistry: {url, type: confluent|apicurio|karapace, auth?}`.
`type` only affects a handful of implementation-specific endpoints (e.g.
Apicurio's group/artifact model exposed through its `ccompat` shim) — the
core subject/version API is identical across all three.

## Tips / limitations

- k-shui talks the **Confluent-compatible (`ccompat`) API** everywhere;
  Apicurio and Karapace both implement it, so point `url` at their `ccompat`
  endpoint (e.g. `.../apis/ccompat/v7` for Apicurio), not their native API.
- A subject whose versions are all soft-deleted can't be served by the
  registry; the detail page says so and offers a permanent delete to reclaim
  the name.
- Schema deletion is destructive to consumers that resolve by subject+version
  — prefer a compatibility-safe new version over deleting a live one.
- Protobuf schemas with cross-subject `references` need those referenced
  subjects registered first; the diff/compatibility endpoints resolve
  references but won't invent missing ones.
