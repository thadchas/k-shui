import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONE_MAP: Record<string, StatusTone> = {
  online: 'success',
  healthy: 'success',
  running: 'success',
  stable: 'success',
  active: 'success',
  ok: 'success',
  up: 'success',
  connected: 'success',
  degraded: 'warning',
  paused: 'warning',
  lagging: 'warning',
  warning: 'warning',
  rebalancing: 'warning',
  preparingrebalance: 'warning',
  completingrebalance: 'warning',
  restarting: 'warning',
  initializing: 'warning',
  pending: 'warning',
  offline: 'danger',
  failed: 'danger',
  unhealthy: 'danger',
  error: 'danger',
  dead: 'danger',
  down: 'danger',
  canceled: 'danger',
  cancelled: 'danger',
  stopped: 'muted',
  empty: 'muted',
  unknown: 'muted',
  unassigned: 'muted',
  finished: 'info',
  created: 'info',
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return 'muted';
  return TONE_MAP[status.toLowerCase().replace(/[\s_-]/g, '')] ?? 'muted';
}

const TONE_CLASSES: Record<StatusTone, { dot: string; text: string; bg: string }> = {
  success: {
    dot: 'bg-[var(--success)]',
    text: 'text-[var(--success)]',
    bg: 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)]',
  },
  warning: {
    dot: 'bg-[var(--warning)]',
    text: 'text-[var(--warning)]',
    bg: 'bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]',
  },
  danger: {
    dot: 'bg-[var(--danger)]',
    text: 'text-[var(--danger)]',
    bg: 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]',
  },
  info: {
    dot: 'bg-[var(--info)]',
    text: 'text-[var(--info)]',
    bg: 'bg-[color-mix(in_srgb,var(--info)_14%,transparent)]',
  },
  muted: {
    dot: 'bg-[var(--muted)]',
    text: 'text-[var(--muted)]',
    bg: 'bg-[var(--surface-2)]',
  },
};

export interface StatusPillProps {
  status: string | null | undefined;
  label?: string;
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
}

export function StatusPill({ status, label, tone, pulse, className }: StatusPillProps) {
  const resolved = tone ?? statusTone(status);
  const classes = TONE_CLASSES[resolved];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium capitalize whitespace-nowrap',
        classes.bg,
        classes.text,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {pulse ? (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-60',
              classes.dot,
            )}
          />
        ) : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', classes.dot)} />
      </span>
      {label ?? status ?? 'unknown'}
    </span>
  );
}

export function StatusDot({ status, tone, className }: Omit<StatusPillProps, 'label' | 'pulse'>) {
  const resolved = tone ?? statusTone(status);
  return (
    <span
      className={cn('inline-block size-2 rounded-full', TONE_CLASSES[resolved].dot, className)}
    />
  );
}
