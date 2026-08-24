import type { DashboardPanelSpec, Series } from '@/api/types';
import type { Unit } from '@/lib/format';

/** Map a Grafana-style unit id onto the k-shui formatter unit + a scale factor. */
export function panelUnit(unit: string | undefined): { unit: Unit; scale: number; suffix: string } {
  switch ((unit ?? '').toLowerCase()) {
    case 'bps':
    case 'binbps':
    case 'bytes/sec':
    case 'bytespersecond':
      return { unit: 'bytes/s', scale: 1, suffix: '' };
    case 'bytes':
    case 'decbytes':
    case 'bin bytes':
    case 'bytes(si)':
      return { unit: 'bytes', scale: 1, suffix: '' };
    case 'percent':
      return { unit: 'percent', scale: 1, suffix: '' };
    case 'percentunit':
      return { unit: 'percent', scale: 100, suffix: '' };
    case 'ms':
    case 'millis':
      return { unit: 'ms', scale: 1, suffix: '' };
    case 's':
    case 'seconds':
      return { unit: 'ms', scale: 1000, suffix: '' };
    case 'ops':
    case 'reqps':
    case 'rps':
    case 'wps':
    case 'pps':
      return { unit: 'req/s', scale: 1, suffix: '' };
    case 'msgs':
    case 'msgps':
      return { unit: 'msg/s', scale: 1, suffix: '' };
    default:
      return { unit: 'count', scale: 1, suffix: '' };
  }
}

export function scaleSeries(series: Series[] | undefined, scale: number): Series[] {
  if (!series) return [];
  if (scale === 1) return series;
  return series.map((s) => ({
    ...s,
    points: s.points.map(([ts, v]) => [ts, v * scale] as [number, number]),
  }));
}

export function latestOf(series: Series | undefined): number | null {
  if (!series || series.points.length === 0) return null;
  const last = series.points[series.points.length - 1];
  return Number.isFinite(last[1]) ? last[1] : null;
}

const THRESHOLD_COLORS: Record<string, string> = {
  green: 'var(--success)',
  red: 'var(--danger)',
  yellow: 'var(--warning)',
  orange: 'var(--warning)',
  blue: 'var(--info)',
  teal: 'var(--primary)',
};

/** Highest matching threshold wins (Grafana semantics: value >= threshold). */
export function thresholdColor(
  value: number | null,
  thresholds: { value: number; color: string }[] | undefined,
): string | null {
  if (value === null || !thresholds || thresholds.length === 0) return null;
  const sorted = [...thresholds].sort((a, b) => a.value - b.value);
  let color: string | null = null;
  for (const t of sorted) if (value >= t.value) color = THRESHOLD_COLORS[t.color] ?? t.color;
  return color;
}

export const PANEL_TYPES = [
  { label: 'Time series', value: 'timeseries' },
  { label: 'Stat', value: 'stat' },
  { label: 'Gauge', value: 'gauge' },
  { label: 'Bar', value: 'bar' },
  { label: 'Table', value: 'table' },
  { label: 'Heatmap', value: 'heatmap' },
];

export const PANEL_UNITS = [
  { label: 'Short (count)', value: 'short' },
  { label: 'Bytes', value: 'bytes' },
  { label: 'Bytes/sec', value: 'Bps' },
  { label: 'Ops/sec', value: 'ops' },
  { label: 'Milliseconds', value: 'ms' },
  { label: 'Seconds', value: 's' },
  { label: 'Percent (0-100)', value: 'percent' },
  { label: 'Percent (0-1)', value: 'percentunit' },
];

/** Column span + pixel height defaults per panel type. */
export function panelGeometry(panel: DashboardPanelSpec): { w: number; h: number } {
  const type = panel.type;
  const defaults: Record<string, { w: number; h: number }> = {
    stat: { w: 2, h: 116 },
    gauge: { w: 3, h: 176 },
    timeseries: { w: 6, h: 260 },
    bar: { w: 6, h: 260 },
    table: { w: 6, h: 260 },
    heatmap: { w: 12, h: 240 },
  };
  const base = defaults[type] ?? defaults.timeseries;
  return {
    w: Math.min(12, Math.max(1, panel.w ?? base.w)),
    h: Math.max(80, panel.h ?? base.h),
  };
}

export function newPanelId(existing: string[]): string {
  let i = existing.length + 1;
  let id = `panel-${i}`;
  while (existing.includes(id)) {
    i += 1;
    id = `panel-${i}`;
  }
  return id;
}

/** Pretty label for a Prometheus metric result: `name{a="1",b="2"}` */
export function promSeriesName(metric: Record<string, string>): string {
  const { __name__: name, ...labels } = metric;
  const entries = Object.entries(labels);
  if (entries.length === 0) return name ?? '{}';
  const inner = entries.map(([k, v]) => `${k}="${v}"`).join(', ');
  return `${name ?? ''}{${inner}}`;
}

/** Convert a Prometheus range (matrix) response into chartable series. */
export function promMatrixToSeries(
  result: { metric: Record<string, string>; values: [number, string][] }[] | undefined,
): Series[] {
  if (!result) return [];
  return result.map((r) => ({
    name: promSeriesName(r.metric),
    labels: r.metric,
    points: r.values
      .map(([ts, v]) => [ts * 1000, Number(v)] as [number, number])
      .filter(([, v]) => Number.isFinite(v)),
  }));
}
