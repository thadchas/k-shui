import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import type { HealthCheck, HealthStatus } from '@/api/types';
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

export interface HealthChecksProps {
  checks: HealthCheck[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

export function HealthChecks({ checks, loading, error, onRetry, className }: HealthChecksProps) {
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

  return (
    <ul className={cn('divide-y divide-[var(--border)]', className)}>
      {checks.map((check) => {
        const status = (check.status ?? 'unknown') as HealthStatus;
        const Icon = ICONS[status] ?? CircleHelp;
        return (
          <li key={check.name} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
            <Icon className={cn('mt-0.5 size-4 shrink-0', COLORS[status] ?? COLORS.unknown)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--foreground)]">{check.name}</p>
              {check.message ? (
                <p className="text-xs text-[var(--muted)]">{check.message}</p>
              ) : null}
            </div>
            <span
              className={cn(
                'shrink-0 text-2xs font-medium capitalize',
                COLORS[status] ?? COLORS.unknown,
              )}
            >
              {status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
