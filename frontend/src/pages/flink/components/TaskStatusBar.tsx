import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { normalizeTaskCounts, TASK_STATE_COLOR, totalTasks } from '../flinkLib';

export interface TaskStatusBarProps {
  tasks: Record<string, number> | undefined | null;
  className?: string;
  showCounts?: boolean;
  height?: number;
}

/** Flink Web UI style stacked bar of subtask states. */
export function TaskStatusBar({
  tasks,
  className,
  showCounts = true,
  height = 8,
}: TaskStatusBarProps) {
  const segments = normalizeTaskCounts(tasks);
  const total = totalTasks(tasks);

  if (total === 0 || segments.length === 0) {
    return <span className={cn('text-xs text-[var(--muted)]', className)}>—</span>;
  }

  const summary = segments.map((s) => `${s.count} ${s.state.toLowerCase()}`).join(' · ');

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Tooltip content={summary}>
        <div
          className="flex min-w-[72px] flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]"
          style={{ height }}
          role="img"
          aria-label={summary}
        >
          {segments.map((s) => (
            <span
              key={s.state}
              style={{
                width: `${(s.count / total) * 100}%`,
                background: TASK_STATE_COLOR[s.state] ?? 'var(--muted)',
              }}
            />
          ))}
        </div>
      </Tooltip>
      {showCounts ? (
        <span className="shrink-0 font-mono text-2xs tabular-nums text-[var(--muted)]">
          {segments[0].count}/{total}
        </span>
      ) : null}
    </div>
  );
}

export function TaskStatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {Object.entries(TASK_STATE_COLOR).map(([state, color]) => (
        <span key={state} className="inline-flex items-center gap-1.5 text-2xs text-[var(--muted)]">
          <span className="size-2 rounded-full" style={{ background: color }} />
          {state.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

/** Horizontal usage meter (slots, heap, managed memory). */
export function UsageBar({
  used,
  total,
  label,
  format,
  tone,
  className,
}: {
  used: number;
  total: number;
  label?: string;
  format?: (v: number) => string;
  tone?: 'primary' | 'warning' | 'danger';
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color =
    tone === 'danger'
      ? 'var(--danger)'
      : tone === 'warning'
        ? 'var(--warning)'
        : pct > 90
          ? 'var(--danger)'
          : pct > 75
            ? 'var(--warning)'
            : 'var(--primary)';
  const fmt = format ?? ((v: number) => String(v));

  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        {label ? (
          <span className="truncate text-2xs font-medium uppercase tracking-wide text-[var(--muted)]">
            {label}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-2xs tabular-nums text-[var(--foreground)]">
          {fmt(used)} / {fmt(total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span
          className="block h-full rounded-full transition-[width] duration-150"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
