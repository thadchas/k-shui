import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, XCircle } from 'lucide-react';
import type { HealthCheck, HealthStatus } from '@/api/types';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';

const ICONS: Record<HealthStatus, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  unhealthy: XCircle,
  unknown: CircleHelp,
};

const COLORS: Record<HealthStatus, string> = {
  healthy: 'text-[var(--success)]',
  degraded: 'text-[var(--warning)]',
  unhealthy: 'text-[var(--danger)]',
  unknown: 'text-[var(--muted)]',
};

/** Unhealthy first so problems never hide below the fold. */
const SEVERITY: Record<HealthStatus, number> = {
  unhealthy: 0,
  degraded: 1,
  unknown: 2,
  healthy: 3,
};

/** The API reports ok / warn / error; older payloads use the canonical names directly. */
function normalizeStatus(status: string | null | undefined): HealthStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'healthy':
    case 'online':
      return 'healthy';
    case 'warn':
    case 'warning':
    case 'degraded':
      return 'degraded';
    case 'error':
    case 'unhealthy':
    case 'offline':
      return 'unhealthy';
    default:
      return 'unknown';
  }
}

/** Messages longer than this are clipped to one line until the row is expanded. */
const CLAMP_LENGTH = 80;

export interface HealthChecksProps {
  checks: HealthCheck[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** `query.dataUpdatedAt` — renders a "checked N ago" footer that ticks every 30s. */
  dataUpdatedAt?: number;
  className?: string;
}

function useTick(intervalMs: number, enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
}

export function HealthChecks({
  checks,
  loading,
  error,
  onRetry,
  dataUpdatedAt,
  className,
}: HealthChecksProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useTick(30_000, Boolean(dataUpdatedAt));

  const sorted = useMemo(() => {
    const list = (checks ?? []).map((check, index) => ({
      check,
      index,
      status: normalizeStatus(check.status),
    }));
    return list.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.index - b.index);
  }, [checks]);

  if (loading) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <InlineError error={error} onRetry={onRetry} className={className} />;
  if (!checks || checks.length === 0) {
    return (
      <EmptyState
        compact
        icon={CheckCircle2}
        title="No health checks reported"
        className={className}
      />
    );
  }

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className={className}>
      <ul className="divide-y divide-[var(--border)]">
        {sorted.map(({ check, status }) => {
          const Icon = ICONS[status];
          const message = check.message ?? '';
          const isLong = message.length > CLAMP_LENGTH || message.includes('\n');
          const isOpen = expanded.has(check.name);
          const canExpand = isLong;
          return (
            <li key={check.name} className="py-2.5 first:pt-0 last:pb-0">
              <div
                className={cn(
                  'flex items-start gap-2.5',
                  canExpand && 'cursor-pointer select-none',
                )}
                role={canExpand ? 'button' : undefined}
                tabIndex={canExpand ? 0 : undefined}
                aria-expanded={canExpand ? isOpen : undefined}
                onClick={canExpand ? () => toggle(check.name) : undefined}
                onKeyDown={
                  canExpand
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle(check.name);
                        }
                      }
                    : undefined
                }
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', COLORS[status])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)]">{check.name}</p>
                  {message ? (
                    <p
                      className={cn(
                        'text-xs text-[var(--muted)]',
                        isOpen ? 'whitespace-pre-wrap break-words' : 'truncate',
                      )}
                      title={!isOpen && isLong ? message : undefined}
                    >
                      {message}
                    </p>
                  ) : null}
                </div>
                <span className={cn('shrink-0 text-2xs font-medium capitalize', COLORS[status])}>
                  {status}
                </span>
                {canExpand ? (
                  <ChevronDown
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0 text-[var(--muted)] transition-transform',
                      isOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {dataUpdatedAt ? (
        <p className="mt-3 border-t border-[var(--border)] pt-2 text-2xs text-[var(--muted)]">
          Last checked {formatRelative(dataUpdatedAt)}
        </p>
      ) : null}
    </div>
  );
}
