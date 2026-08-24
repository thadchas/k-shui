import type { Series, SeriesPoint } from '@/api/types';
import type { Unit } from './format';

/** DESIGN.md ordered, colorblind-safe palette. Never purple/violet/indigo. */
export const CHART_COLORS = [
  '#14B8A6',
  '#0EA5E9',
  '#F59E0B',
  '#F43F5E',
  '#22C55E',
  '#3B82F6',
  '#A3E635',
  '#F97316',
  '#06B6D4',
  '#EAB308',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export interface ChartRow {
  ts: number;
  [seriesName: string]: number | null;
}

/**
 * Merge `{series:[{name, points:[[ts, v]]}]}` into recharts row objects keyed by
 * timestamp, so multiple series with different sample times still align.
 */
export function seriesToRows(series: Series[] | undefined): ChartRow[] {
  if (!series || series.length === 0) return [];
  const byTs = new Map<number, ChartRow>();
  for (const s of series) {
    for (const [ts, value] of s.points as SeriesPoint[]) {
      let row = byTs.get(ts);
      if (!row) {
        row = { ts };
        byTs.set(ts, row);
      }
      row[s.name] = Number.isFinite(value) ? value : null;
    }
  }
  const rows = Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  // fill gaps with null so recharts breaks the line rather than interpolating
  const names = series.map((s) => s.name);
  for (const row of rows) {
    for (const name of names) if (!(name in row)) row[name] = null;
  }
  return rows;
}

export function pickSeries(series: Series[] | undefined, names: string[]): Series[] {
  if (!series) return [];
  return names.map((n) => series.find((s) => s.name === n)).filter((s): s is Series => Boolean(s));
}

export function latestValue(series: Series | undefined): number | null {
  if (!series || series.points.length === 0) return null;
  return series.points[series.points.length - 1][1];
}

/** Rough unit inference from a series name (bytesIn → bytes/s, etc). */
export function inferUnit(name: string): Unit {
  const n = name.toLowerCase();
  if (n.includes('bytes')) return 'bytes/s';
  if (n.includes('size') || n.includes('heap') || n.includes('disk')) return 'bytes';
  if (n.includes('latency') || n.includes('time') || n.endsWith('ms')) return 'ms';
  if (n.includes('pct') || n.includes('percent') || n.includes('idle') || n.includes('usage'))
    return 'percent';
  if (n.includes('request')) return 'req/s';
  if (n.includes('messages') || n.includes('msg')) return 'msg/s';
  return 'count';
}

/** Human label for a camelCase series name. */
export function seriesLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
