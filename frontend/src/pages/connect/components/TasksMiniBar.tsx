import type { ConnectorTask } from '@/api/types';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { taskCounts } from './connectUtils';

export interface TasksMiniBarProps {
  tasks: ConnectorTask[] | undefined | null;
  className?: string;
}

/** Compact running/failed task ratio with a segmented bar. */
export function TasksMiniBar({ tasks, className }: TasksMiniBarProps) {
  const counts = taskCounts(tasks);

  if (counts.total === 0) {
    return <span className={cn('text-2xs text-[var(--muted)]', className)}>no tasks</span>;
  }

  const segments = [
    { key: 'running', count: counts.running, color: 'bg-[var(--success)]' },
    { key: 'failed', count: counts.failed, color: 'bg-[var(--danger)]' },
    { key: 'paused', count: counts.paused, color: 'bg-[var(--warning)]' },
    { key: 'other', count: counts.other, color: 'bg-[var(--muted)]' },
  ].filter((s) => s.count > 0);

  return (
    <Tooltip
      content={
        <span className="font-mono text-2xs">
          {counts.running} running · {counts.failed} failed · {counts.paused} paused ·{' '}
          {counts.total} total
        </span>
      }
    >
      <span className={cn('inline-flex items-center gap-2', className)}>
        <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={segment.color}
              style={{ width: `${(segment.count / counts.total) * 100}%` }}
            />
          ))}
        </span>
        <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
          {counts.running}/{counts.total}
          {counts.failed > 0 ? (
            <span className="ml-1 text-[var(--danger)]">·{counts.failed} failed</span>
          ) : null}
        </span>
      </span>
    </Tooltip>
  );
}
