import type { ExportFormat, Message } from '@/api/types';
import { formatTimestamp } from '@/lib/format';

export type TimestampFormat = 'local' | 'utc' | 'epoch';

export const TIMESTAMP_FORMAT_KEY = 'k-shui.messages.timestampFormat';

export const TIMESTAMP_FORMAT_OPTIONS: { label: string; value: TimestampFormat }[] = [
  { label: 'Local', value: 'local' },
  { label: 'UTC', value: 'utc' },
  { label: 'Epoch', value: 'epoch' },
];

export function readTimestampFormat(): TimestampFormat {
  try {
    const raw = localStorage.getItem(TIMESTAMP_FORMAT_KEY);
    if (raw === 'local' || raw === 'utc' || raw === 'epoch') return raw;
  } catch {
    /* storage unavailable */
  }
  return 'local';
}

export function writeTimestampFormat(value: TimestampFormat): void {
  try {
    localStorage.setItem(TIMESTAMP_FORMAT_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatMessageTimestamp(
  ts: number | null | undefined,
  format: TimestampFormat,
): string {
  if (ts === null || ts === undefined) return '—';
  if (format === 'epoch') return String(ts);
  if (format === 'utc') {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours(),
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
  }
  return formatTimestamp(ts);
}

/** A tombstone is a keyed record whose value is null (compaction delete marker). */
export function isTombstone(message: Pick<Message, 'key' | 'value'>): boolean {
  return message.key !== null && message.key !== undefined && message.value === null;
}

export function stringifyField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialise an in-memory message buffer using the same shapes as the server export. */
export function serializeMessages(
  messages: Message[],
  format: ExportFormat,
): { blob: Blob; extension: string } {
  const items = messages.map(({ keyRaw: _keyRaw, valueRaw: _valueRaw, ...rest }) => rest);
  if (format === 'json') {
    return {
      blob: new Blob([JSON.stringify({ items, scanned: items.length }, null, 2)], {
        type: 'application/json',
      }),
      extension: 'json',
    };
  }
  if (format === 'ndjson') {
    return {
      blob: new Blob([items.map((m) => JSON.stringify(m)).join('\n')], {
        type: 'application/x-ndjson',
      }),
      extension: 'ndjson',
    };
  }
  const lines = ['partition,offset,timestamp,key,value,headers'];
  for (const m of items) {
    lines.push(
      [
        String(m.partition),
        String(m.offset),
        String(m.timestamp ?? ''),
        csvCell(stringifyField(m.key)),
        csvCell(stringifyField(m.value)),
        csvCell(stringifyField(m.headers)),
      ].join(','),
    );
  }
  return { blob: new Blob([lines.join('\n')], { type: 'text/csv' }), extension: 'csv' };
}
