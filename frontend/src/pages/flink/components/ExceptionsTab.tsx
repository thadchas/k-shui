import { useMemo } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useFlinkExceptionsFull } from '@/api/hooks/flink';
import type { FlinkExceptionEntry } from '@/api/types';
import { formatTimestamp } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';

interface ExceptionGroup {
  key: string;
  count: number;
  firstSeen: number | null;
  lastSeen: number | null;
  /** Most recent occurrence — its stack trace is what we render. */
  latest: FlinkExceptionEntry;
  taskNames: string[];
}

/** Signature = first 3 non-empty lines of the stack trace (falls back to the exception name). */
export function exceptionSignature(entry: FlinkExceptionEntry): string {
  const lines = (entry.stacktrace ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return lines.length > 0 ? lines.join('\n') : (entry.exceptionName ?? 'unknown');
}

/** Group identical failures so a restart loop shows as one row with a count. */
export function groupExceptions(entries: FlinkExceptionEntry[]): ExceptionGroup[] {
  const groups = new Map<string, ExceptionGroup>();
  for (const entry of entries) {
    const key = exceptionSignature(entry);
    const ts = typeof entry.timestamp === 'number' ? entry.timestamp : null;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        count: 1,
        firstSeen: ts,
        lastSeen: ts,
        latest: entry,
        taskNames: entry.taskName ? [entry.taskName] : [],
      });
      continue;
    }
    existing.count += 1;
    if (ts !== null) {
      if (existing.firstSeen === null || ts < existing.firstSeen) existing.firstSeen = ts;
      if (existing.lastSeen === null || ts > existing.lastSeen) {
        existing.lastSeen = ts;
        existing.latest = entry;
      }
    }
    if (entry.taskName && !existing.taskNames.includes(entry.taskName)) {
      existing.taskNames.push(entry.taskName);
    }
  }
  return Array.from(groups.values()).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

export function ExceptionsTab({
  cluster,
  flinkCluster,
  jid,
}: {
  cluster: string;
  flinkCluster: string;
  jid: string;
}) {
  const { data, isLoading, error, refetch } = useFlinkExceptionsFull(cluster, flinkCluster, jid);
  const history = useMemo(
    () => data?.exceptionHistory?.entries ?? data?.allExceptions ?? [],
    [data],
  );
  const groups = useMemo(() => groupExceptions(history), [history]);

  if (error) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!data?.rootException && history.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CircleCheck}
          title="No exceptions"
          description="This job has not reported any failures."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data?.rootException ? (
        <Card>
          <CardToolbarHeader
            title={
              <span className="flex items-center gap-2">
                <TriangleAlert className="size-4 text-[var(--danger)]" />
                Root exception
              </span>
            }
            description={data.timestamp ? formatTimestamp(data.timestamp) : undefined}
          />
          <CardContent>
            <CodeBlock code={data.rootException} maxHeight={360} showCopy />
          </CardContent>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <CardToolbarHeader
            title="Exception history"
            description={`${history.length} recorded failure${history.length === 1 ? '' : 's'} · ${groups.length} distinct (grouped by the first 3 stack-trace lines)`}
            actions={
              data?.truncated || data?.exceptionHistory?.truncated ? (
                <Badge variant="warning">truncated</Badge>
              ) : null
            }
          />
          <CardContent className="space-y-3">
            {groups.map((group) => {
              const entry = group.latest;
              return (
                <div
                  key={group.key}
                  className="rounded-[var(--radius-control)] border border-[var(--border)]"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                    <Badge variant={group.count > 1 ? 'warning' : 'secondary'} size="sm">
                      ×{group.count}
                    </Badge>
                    <span className="font-mono text-2xs text-[var(--muted)]">
                      {group.count > 1 ? (
                        <>
                          first {group.firstSeen ? formatTimestamp(group.firstSeen) : '—'} · last{' '}
                          {group.lastSeen ? formatTimestamp(group.lastSeen) : '—'}
                        </>
                      ) : (
                        <>{group.lastSeen ? formatTimestamp(group.lastSeen) : '—'}</>
                      )}
                    </span>
                    {group.taskNames.slice(0, 3).map((name) => (
                      <Badge key={name} variant="secondary" size="sm">
                        {name}
                      </Badge>
                    ))}
                    {group.taskNames.length > 3 ? (
                      <span className="text-2xs text-[var(--muted)]">
                        +{group.taskNames.length - 3} more tasks
                      </span>
                    ) : null}
                    {entry.location ? (
                      <span className="font-mono text-2xs text-[var(--muted)]">
                        {entry.location}
                      </span>
                    ) : null}
                    {entry.exceptionName ? (
                      <span className="truncate text-2xs font-medium text-[var(--danger)]">
                        {entry.exceptionName}
                      </span>
                    ) : null}
                  </div>
                  <CodeBlock
                    code={entry.stacktrace ?? entry.exceptionName ?? ''}
                    maxHeight={240}
                    className="rounded-none border-0"
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
