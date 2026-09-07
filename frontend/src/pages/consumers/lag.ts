import type { ConsumerGroupMember, ConsumerGroupPartition, SeriesPoint } from '@/api/types';
import { formatDuration } from '@/lib/format';

/**
 * Render a backend time-lag estimate (`timeLagMs` / `maxTimeLagMs`).
 *
 * The API returns `null` when the sampler has no produce rate for the topic yet (fewer than
 * two samples) or the topic is idle (rate <= 0); both render as an em dash so a missing
 * estimate is never mistaken for "caught up".
 */
export function formatTimeLag(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms <= 0) return '0s';
  if (ms < 1000) return '<1s';
  return formatDuration(ms);
}

/** Warning threshold for the time-lag column (5 minutes). */
export const TIME_LAG_WARN_MS = 5 * 60_000;

/* ------------------------------ worst partition ---------------------------- */

export interface WorstPartition {
  topic: string;
  partition: number;
  lag: number;
}

/**
 * The topic-partition with the largest *known* lag.
 *
 * Partitions with `lag: null` (unknown, not zero) are excluded from the comparison rather than
 * treated as the smallest value — an unknown reading must never win, or lose, a "worst" ranking.
 * Returns `null` when there are no partitions with a known lag (including "no partitions at all").
 */
export function findWorstPartition(
  partitions: ConsumerGroupPartition[] | null | undefined,
): WorstPartition | null {
  let worst: WorstPartition | null = null;
  for (const p of partitions ?? []) {
    if (p.lag === null || p.lag === undefined || Number.isNaN(p.lag)) continue;
    if (!worst || p.lag > worst.lag) {
      worst = { topic: p.topic, partition: p.partition, lag: p.lag };
    }
  }
  return worst;
}

/* ------------------------------ assignment skew ----------------------------- */

export interface AssignmentSkew {
  memberCount: number;
  minPartitions: number;
  maxPartitions: number;
  /**
   * Busiest member's partition count ÷ least-busy member's, i.e. how unevenly partitions are
   * spread across the group. `null` when the ratio can't be meaningfully computed: fewer than
   * two members (nothing to compare), or the least-busy member holds zero partitions (would
   * divide by zero — that member is simply idle, not "infinitely skewed").
   */
  ratio: number | null;
}

/**
 * Assignment skew compares the busiest member's partition count to the idlest member's.
 * A ratio well above 1 means partitions aren't spread evenly — one consumer can be a
 * processing bottleneck even while the group's total lag looks fine.
 */
export function computeAssignmentSkew(
  members: ConsumerGroupMember[] | null | undefined,
): AssignmentSkew {
  const counts = (members ?? []).map((m) => m.assignments?.length ?? 0);
  const memberCount = counts.length;
  if (memberCount === 0) {
    return { memberCount: 0, minPartitions: 0, maxPartitions: 0, ratio: null };
  }
  const minPartitions = Math.min(...counts);
  const maxPartitions = Math.max(...counts);
  const ratio = memberCount < 2 || minPartitions === 0 ? null : maxPartitions / minPartitions;
  return { memberCount, minPartitions, maxPartitions, ratio };
}

/* ---------------------------- processing health ----------------------------- */

export type ProcessingHealth = 'caught-up' | 'falling-behind' | 'unknown';

export const PROCESSING_HEALTH_LABEL: Record<ProcessingHealth, string> = {
  'caught-up': 'Caught up',
  'falling-behind': 'Falling behind',
  unknown: 'No data',
};

/**
 * "Stable" (see `ConsumerGroupState`) is a coordinator-level judgement about group
 * membership — it says nothing about whether consumers are keeping up with production.
 * This explains the distinction in one line, for use next to the state pill.
 */
export const PROCESSING_HEALTH_EXPLAINER =
  '"Stable" describes membership (the coordinator sees an active, balanced group) — it does not mean consumers are keeping up with production.';

/** Most recent lag reading: the backend's rolled-up total when known, else the latest sample. */
function resolveCurrentLag(
  totalLag: number | null | undefined,
  points: SeriesPoint[] | null | undefined,
): number | null {
  if (totalLag !== null && totalLag !== undefined && !Number.isNaN(totalLag)) return totalLag;
  if (points && points.length > 0) {
    const value = points[points.length - 1][1];
    return Number.isNaN(value) ? null : value;
  }
  return null;
}

/**
 * Derives a processing-health signal that is independent of the group's membership state.
 *
 * - `unknown` when there is no lag reading to go on at all (missing `totalLag` and no lag
 *   history). This must never resolve to `caught-up` — a monitoring gap is not a clean bill
 *   of health.
 * - `caught-up` when the most recent known lag is zero (or less).
 * - `falling-behind` otherwise, i.e. any outstanding lag — including a group whose lag
 *   history shows sustained growth over the observed window.
 */
export function deriveProcessingHealth({
  totalLag,
  points,
}: {
  totalLag: number | null | undefined;
  points?: SeriesPoint[] | null;
}): ProcessingHealth {
  const current = resolveCurrentLag(totalLag, points);
  if (current === null) return 'unknown';
  return current <= 0 ? 'caught-up' : 'falling-behind';
}
