import { Badge } from '@/components/ui/badge';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ConsumptionStatus } from './messageSearch';

const TONE: Record<ConsumptionStatus['id'], string> = {
  live: 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]',
  paused: 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]',
  fetching: 'bg-[color-mix(in_srgb,var(--info)_16%,transparent)] text-[var(--info)]',
  stopped: 'bg-[var(--surface-2)] text-[var(--muted)]',
  idle: 'bg-[var(--surface-2)] text-[var(--muted)]',
};

export interface MessageStreamStatusProps {
  status: ConsumptionStatus;
  /** Tail only: records the server has still to deliver. */
  behind: number;
  /** Tail only: records buffered while paused. */
  pendingCount: number;
  shown: number;
  scanned: number;
  matched: number;
  limit: number;
  /** Bounded queries only: rough denominator for the progress bar. */
  estimatedTotal: number;
  progressPct: number;
  live: boolean;
}

/**
 * The consumption state strip: an always-spelled-out Live / Paused / Fetching / Stopped /
 * Idle label plus the counters and (for bounded queries) a progress bar.
 */
export function MessageStreamStatus({
  status,
  behind,
  pendingCount,
  shown,
  scanned,
  matched,
  limit,
  estimatedTotal,
  progressPct,
  live,
}: MessageStreamStatusProps) {
  return (
    <div
      className="mt-4 space-y-1.5"
      role="status"
      aria-live="polite"
      data-testid="message-stream-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-[var(--muted)]">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide',
              TONE[status.id],
            )}
          >
            <span className="relative flex size-2">
              {status.id === 'live' || status.id === 'fetching' ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
              ) : null}
              <span className="relative inline-flex size-2 rounded-full bg-current" />
            </span>
            {status.label}
          </span>
          <span className="normal-case">{status.description}</span>
          {status.id === 'idle' ? null : live &&
            (status.id === 'live' || status.id === 'paused') ? (
            behind > 0 ? (
              <Badge variant="warning" size="sm">
                {formatCompact(behind)} behind
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                caught up
              </Badge>
            )
          ) : null}
          {status.id === 'paused' && pendingCount > 0 ? (
            <Badge variant="info" size="sm">
              {formatCompact(pendingCount)} new while paused
            </Badge>
          ) : null}
          {status.id === 'idle' ? null : (
            <span className="font-mono tabular-nums">
              {formatCompact(shown)} shown
              {live ? ` (last ${formatCompact(limit)})` : ''} · {formatCompact(scanned)}{' '}
              {live ? 'seen' : 'scanned'}
              {!live && estimatedTotal > 0 ? ` of ~${formatCompact(estimatedTotal)}` : ''} ·{' '}
              {formatCompact(matched)} matched
            </span>
          )}
        </span>
        {status.id === 'idle' ? null : live ? (
          <span>Newest first · following from the end of the topic</span>
        ) : (
          <span className="font-mono tabular-nums">{progressPct}%</span>
        )}
      </div>
      {live || status.id === 'idle' ? null : (
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className={cn(
              'h-full rounded-full bg-[var(--primary)] transition-[width] duration-200',
              status.id === 'fetching' && 'animate-pulse',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
