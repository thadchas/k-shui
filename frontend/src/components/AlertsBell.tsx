import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { useAlertSummary } from '@/api/hooks/alerts';
import type { AlertSummary } from '@/api/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

function totalOf(summary: AlertSummary | undefined): number {
  if (!summary) return 0;
  if (typeof summary.total === 'number') return summary.total;
  return Object.values(summary.bySeverity ?? {}).reduce((a, b) => a + (b ?? 0), 0);
}

/** Topbar bell. Degrades silently when `/alerts/summary` is unavailable. */
export function AlertsBell({ className }: { className?: string }) {
  const { data, isError } = useAlertSummary();

  const total = totalOf(data);
  const critical = data?.bySeverity?.critical ?? 0;
  const warning = data?.bySeverity?.warning ?? 0;

  const tooltip = isError
    ? 'Alerts'
    : total === 0
      ? 'No firing alerts'
      : `${critical} critical · ${warning} warning`;

  return (
    <Tooltip content={tooltip}>
      <Button
        asChild
        variant="ghost"
        size="icon"
        className={cn('relative', className)}
        aria-label="Alerts"
      >
        <Link to="/alerts">
          <Bell />
          {total > 0 ? (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white',
                critical > 0 ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]',
              )}
            >
              {total > 99 ? '99+' : total}
            </span>
          ) : null}
        </Link>
      </Button>
    </Tooltip>
  );
}
