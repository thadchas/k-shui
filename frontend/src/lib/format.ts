import { formatDistanceToNowStrict, format as fnsFormat } from 'date-fns';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return plain.format(n);
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) < 1000) return plain.format(n);
  return compact.format(n);
}

export function formatDecimal(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return decimal.format(n);
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—';
  return pct.format(fraction);
}

/** Percent where input is already 0..100 */
export function formatPercentValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${decimal.format(value)}%`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const neg = bytes < 0;
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : fractionDigits;
  return `${neg ? '-' : ''}${v.toFixed(digits)} ${BYTE_UNITS[i]}`;
}

export function formatBytesPerSec(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  return `${formatBytes(bytes)}/s`;
}

export function formatRate(n: number | null | undefined, unit = 'msg/s'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${formatCompact(n)} ${unit}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${decimal.format(ms)} ms`;
  return `${decimal.format(ms / 1000)} s`;
}

/** Humanize a duration given in milliseconds: 604800000 → "7d" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 0) return 'unlimited';
  if (ms === 0) return '0';
  const units: [number, string][] = [
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'm'],
    [1000, 's'],
  ];
  const parts: string[] = [];
  let rest = ms;
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${label}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return `${ms}ms`;
  return parts.join(' ');
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return formatDuration(seconds * 1000);
}

export function formatTimestamp(ts: number | string | Date | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return fnsFormat(d, 'yyyy-MM-dd HH:mm:ss');
}

export function formatTimeShort(ts: number | string | Date | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return fnsFormat(d, 'HH:mm:ss');
}

export function formatRelative(ts: number | string | Date | null | undefined): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export type Unit = 'bytes' | 'bytes/s' | 'msg/s' | 'ms' | 'percent' | 'count' | 'req/s' | 'none';

export function formatUnit(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'bytes':
      return formatBytes(value);
    case 'bytes/s':
      return formatBytesPerSec(value);
    case 'msg/s':
      return `${formatCompact(value)} msg/s`;
    case 'req/s':
      return `${formatCompact(value)} req/s`;
    case 'ms':
      return formatMs(value);
    case 'percent':
      return formatPercentValue(value);
    case 'count':
      return formatCompact(value);
    default:
      return formatDecimal(value);
  }
}

/** Compact axis tick labels (no unit suffix noise). */
export function formatAxis(value: number, unit: Unit): string {
  switch (unit) {
    case 'bytes':
    case 'bytes/s':
      return formatBytes(value, 0);
    case 'ms':
      return formatMs(value);
    case 'percent':
      return `${Math.round(value)}%`;
    default:
      return formatCompact(value);
  }
}

/** Retention presets for topic forms. */
export const RETENTION_PRESETS: { label: string; value: number }[] = [
  { label: '1 hour', value: 3_600_000 },
  { label: '6 hours', value: 21_600_000 },
  { label: '12 hours', value: 43_200_000 },
  { label: '1 day', value: 86_400_000 },
  { label: '3 days', value: 259_200_000 },
  { label: '7 days', value: 604_800_000 },
  { label: '14 days', value: 1_209_600_000 },
  { label: '30 days', value: 2_592_000_000 },
  { label: 'Unlimited', value: -1 },
];

export function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function prettyJson(value: unknown): string {
  try {
    if (typeof value === 'string') {
      const parsed: unknown = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return typeof value === 'string' ? value : String(value);
  }
}
