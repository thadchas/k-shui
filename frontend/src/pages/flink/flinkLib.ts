import { useEffect, useState } from 'react';
import type { StatusTone } from '@/components/ui/status-pill';
import type { FlinkMetricEntry } from '@/api/types';

/** Flink job/vertex states mapped onto the design-system semantic tones. */
export function flinkStateTone(state: string | null | undefined): StatusTone {
  switch ((state ?? '').toUpperCase()) {
    case 'RUNNING':
      return 'success';
    case 'FINISHED':
      return 'info';
    case 'FAILED':
    case 'FAILING':
      return 'danger';
    case 'CANCELED':
    case 'CANCELLED':
    case 'CANCELLING':
    case 'CANCELING':
      return 'warning';
    case 'RESTARTING':
    case 'RECONCILING':
    case 'INITIALIZING':
    case 'CREATED':
    case 'SCHEDULED':
    case 'DEPLOYING':
      return 'warning';
    case 'SUSPENDED':
      return 'muted';
    default:
      return 'muted';
  }
}

export const TASK_STATE_ORDER = [
  'RUNNING',
  'FINISHED',
  'DEPLOYING',
  'SCHEDULED',
  'CREATED',
  'INITIALIZING',
  'RECONCILING',
  'CANCELING',
  'CANCELED',
  'FAILED',
] as const;

export const TASK_STATE_COLOR: Record<string, string> = {
  RUNNING: 'var(--success)',
  FINISHED: 'var(--info)',
  DEPLOYING: '#0EA5E9',
  SCHEDULED: '#06B6D4',
  CREATED: '#A3E635',
  INITIALIZING: 'var(--warning)',
  RECONCILING: 'var(--warning)',
  CANCELING: '#F97316',
  CANCELED: 'var(--muted)',
  FAILED: 'var(--danger)',
};

/** Accepts both the camelCase job list shape and the UPPERCASE vertex shape. */
export function normalizeTaskCounts(
  tasks: Record<string, number> | undefined | null,
): { state: string; count: number }[] {
  if (!tasks) return [];
  const out = new Map<string, number>();
  for (const [key, value] of Object.entries(tasks)) {
    if (key === 'total' || typeof value !== 'number' || value <= 0) continue;
    out.set(key.toUpperCase(), (out.get(key.toUpperCase()) ?? 0) + value);
  }
  return TASK_STATE_ORDER.filter((s) => out.has(s))
    .map((s) => ({ state: s as string, count: out.get(s) ?? 0 }))
    .concat(
      Array.from(out.entries())
        .filter(([s]) => !TASK_STATE_ORDER.includes(s as (typeof TASK_STATE_ORDER)[number]))
        .map(([state, count]) => ({ state, count })),
    );
}

export function totalTasks(tasks: Record<string, number> | undefined | null): number {
  if (!tasks) return 0;
  if (typeof tasks.total === 'number') return tasks.total;
  return Object.values(tasks).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}

/** A ticking clock so RUNNING durations stay live without refetching. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Live duration for a job: server duration for terminal jobs, wall clock otherwise. */
export function liveDuration(
  startTime: number,
  endTime: number,
  duration: number,
  now: number,
): number {
  if (endTime && endTime > 0) return duration;
  if (!startTime || startTime <= 0) return duration;
  return Math.max(duration, now - startTime);
}

export function metricValue(
  entries: FlinkMetricEntry[] | undefined,
  id: string,
): number | null {
  const hit = entries?.find((e) => e.id === id);
  if (!hit || hit.value === undefined || hit.value === null) return null;
  const n = Number(hit.value);
  return Number.isFinite(n) ? n : null;
}

/** Busy / backpressure ratios derived from the accumulated vertex counters. */
export function ratioPct(part: number | undefined, whole: number | undefined): number | null {
  if (!part && part !== 0) return null;
  if (!whole || whole <= 0) return null;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/** Strip the `[n]:` operator prefixes Flink puts in plan descriptions. */
export function cleanPlanDescription(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Shorten a long Flink operator chain name for node/table display. */
export function shortVertexName(name: string, max = 46): string {
  const first = name.split('->')[0].trim();
  const label = first.length >= 8 ? first : name;
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export const DEFAULT_VERTEX_METRICS = [
  'numRecordsInPerSecond',
  'numRecordsOutPerSecond',
  'busyTimeMsPerSecond',
] as const;
