import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';
import { StatusDot, type StatusTone } from './status-pill';
import { Tooltip } from './tooltip';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatusTone;
  delta?: number | null;
  deltaLabel?: string;
  sparkline?: React.ReactNode;
  loading?: boolean;
  className?: string;
  onClick?: () => void;
  tooltip?: string;
}

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-[var(--success)]',
  warning: 'text-[var(--warning)]',
  danger: 'text-[var(--danger)]',
  info: 'text-[var(--info)]',
  muted: 'text-[var(--foreground)]',
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  delta,
  deltaLabel,
  sparkline,
  loading,
  className,
  onClick,
  tooltip,
}: StatCardProps) {
  const body = (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-card)] transition-colors',
        onClick &&
          'cursor-pointer hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label}
        </span>
        {tone ? (
          <StatusDot status={undefined} tone={tone} />
        ) : Icon ? (
          <Icon className="size-4 text-[var(--muted)]" />
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="flex items-end gap-2">
          <span
            className={cn(
              'truncate font-mono text-[28px] font-semibold leading-9 tabular-nums',
              tone ? TONE_TEXT[tone] : 'text-[var(--foreground)]',
            )}
          >
            {value}
          </span>
          {delta !== undefined && delta !== null ? (
            <span
              className={cn(
                'mb-1.5 inline-flex items-center gap-0.5 text-2xs font-medium',
                delta >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]',
              )}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {Math.abs(delta).toFixed(1)}%
              {deltaLabel ? <span className="text-[var(--muted)]"> {deltaLabel}</span> : null}
            </span>
          ) : null}
        </div>
      )}

      {sparkline ? <div className="-mx-1 h-8">{sparkline}</div> : null}
      {hint ? <p className="truncate text-2xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{body}</Tooltip> : body;
}

export function StatCardGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4',
        className,
      )}
      {...props}
    />
  );
}
