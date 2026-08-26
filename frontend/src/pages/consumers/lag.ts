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
