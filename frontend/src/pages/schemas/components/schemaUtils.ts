import type { Compatibility, SchemaReference, SchemaType } from '@/api/types';
import type { EditorLanguage } from '@/components/CodeEditor';

export const SCHEMA_TYPES: SchemaType[] = ['AVRO', 'PROTOBUF', 'JSON'];

export const COMPATIBILITY_LEVELS: Compatibility[] = [
  'BACKWARD',
  'BACKWARD_TRANSITIVE',
  'FORWARD',
  'FORWARD_TRANSITIVE',
  'FULL',
  'FULL_TRANSITIVE',
  'NONE',
];

export const COMPATIBILITY_OPTIONS = COMPATIBILITY_LEVELS.map((value) => ({
  label: value,
  value,
}));

export const COMPATIBILITY_HELP: Record<Compatibility, string> = {
  BACKWARD: 'New schema can read data written with the previous schema.',
  BACKWARD_TRANSITIVE: 'New schema can read data written with every previous schema.',
  FORWARD: 'Previous schema can read data written with the new schema.',
  FORWARD_TRANSITIVE: 'Every previous schema can read data written with the new schema.',
  FULL: 'Backward and forward compatible with the previous schema.',
  FULL_TRANSITIVE: 'Backward and forward compatible with every previous schema.',
  NONE: 'No compatibility checks are performed.',
};

export const SCHEMA_TYPE_VARIANT: Record<SchemaType, 'default' | 'accent' | 'info'> = {
  AVRO: 'default',
  PROTOBUF: 'accent',
  JSON: 'info',
};

export function editorLanguageForSchema(type: SchemaType | undefined): EditorLanguage {
  return type === 'PROTOBUF' ? 'protobuf' : 'json';
}

/** Pretty-print JSON-ish schemas; protobuf/IDL text is returned unchanged. */
export function prettySchema(schema: string | undefined | null, type?: SchemaType): string {
  if (!schema) return '';
  if (type === 'PROTOBUF') return schema;
  try {
    return JSON.stringify(JSON.parse(schema), null, 2);
  } catch {
    return schema;
  }
}

export function schemaFileExtension(type: SchemaType | undefined): string {
  switch (type) {
    case 'PROTOBUF':
      return 'proto';
    case 'AVRO':
      return 'avsc';
    default:
      return 'json';
  }
}

export type SubjectStrategy =
  'TopicNameStrategy' | 'RecordNameStrategy' | 'TopicRecordNameStrategy';

export const SUBJECT_STRATEGIES: { label: string; value: SubjectStrategy; hint: string }[] = [
  {
    label: 'TopicNameStrategy',
    value: 'TopicNameStrategy',
    hint: '<topic>-key / <topic>-value — the Kafka default.',
  },
  {
    label: 'RecordNameStrategy',
    value: 'RecordNameStrategy',
    hint: '<fully.qualified.RecordName> — one subject per record type across topics.',
  },
  {
    label: 'TopicRecordNameStrategy',
    value: 'TopicRecordNameStrategy',
    hint: '<topic>-<fully.qualified.RecordName> — several record types per topic.',
  },
];

export function buildSubjectName(
  strategy: SubjectStrategy,
  topic: string,
  part: 'key' | 'value',
  recordName: string,
): string {
  switch (strategy) {
    case 'RecordNameStrategy':
      return recordName;
    case 'TopicRecordNameStrategy':
      return topic && recordName ? `${topic}-${recordName}` : '';
    default:
      return topic ? `${topic}-${part}` : '';
  }
}

/** Best-effort topic name behind a `TopicNameStrategy` subject. */
export function topicFromSubject(subject: string): string | null {
  const match = /^(.*)-(key|value)$/.exec(subject);
  return match ? match[1] : null;
}

export const AVRO_TEMPLATE = `{
  "type": "record",
  "name": "MyRecord",
  "namespace": "com.example",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "createdAt", "type": { "type": "long", "logicalType": "timestamp-millis" } }
  ]
}`;

export const JSON_TEMPLATE = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MyRecord",
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "createdAt": { "type": "integer" }
  },
  "required": ["id"]
}`;

export const PROTOBUF_TEMPLATE = `syntax = "proto3";
package com.example;

message MyRecord {
  string id = 1;
  int64 created_at = 2;
}`;

export function schemaTemplate(type: SchemaType): string {
  switch (type) {
    case 'PROTOBUF':
      return PROTOBUF_TEMPLATE;
    case 'JSON':
      return JSON_TEMPLATE;
    default:
      return AVRO_TEMPLATE;
  }
}

/**
 * Minimal client-side sanity check for a protobuf schema: balanced braces,
 * a `syntax = "..."` declaration and at least one `message` (or `enum`) definition.
 * Returns `null` when the text looks well-formed, otherwise a human-readable reason.
 */
export function validateProtobuf(text: string): string | null {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (!source.trim()) return 'Schema is empty';
  let depth = 0;
  for (const ch of source) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return 'Unbalanced braces: unexpected "}"';
    }
  }
  if (depth > 0) return `Unbalanced braces: ${depth} unclosed "{"`;
  if (!/^\s*syntax\s*=\s*["'](proto2|proto3)["']\s*;/m.test(source)) {
    return 'Missing `syntax = "proto3";` (or proto2) declaration';
  }
  if (!/\b(message|enum)\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(source)) {
    return 'No `message` definition found';
  }
  return null;
}

/** Validate any schema type client-side; `null` means "looks fine". */
export function validateSchemaText(text: string, type: SchemaType): string | null {
  if (type === 'PROTOBUF') return validateProtobuf(text);
  if (!text.trim()) return 'Schema is empty';
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid JSON';
  }
}

/** Serialise references for the `?refs=` deep link into the New schema page. */
export function encodeReferencesParam(references: SchemaReference[] | undefined): string | null {
  if (!references?.length) return null;
  try {
    return JSON.stringify(
      references.map((r) => ({ name: r.name, subject: r.subject, version: r.version })),
    );
  } catch {
    return null;
  }
}

export function decodeReferencesParam(raw: string | null): SchemaReference[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is { name: unknown; subject: unknown; version: unknown } =>
          typeof r === 'object' && r !== null && 'name' in r && 'subject' in r,
      )
      .map((r) => ({
        name: String(r.name ?? ''),
        subject: String(r.subject ?? ''),
        version: Number(r.version) > 0 ? Number(r.version) : 1,
      }));
  } catch {
    return [];
  }
}
