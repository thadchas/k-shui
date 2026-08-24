import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useFlinkExceptionsFull } from '@/api/hooks/flink';
import { formatTimestamp } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';

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

  if (error) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const history = data?.exceptionHistory?.entries ?? data?.allExceptions ?? [];

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
            description={`${history.length} recorded failure${history.length === 1 ? '' : 's'}`}
            actions={data?.truncated ? <Badge variant="warning">truncated</Badge> : null}
          />
          <CardContent className="space-y-3">
            {history.map((entry, i) => (
              <div
                key={`${entry.timestamp ?? i}-${i}`}
                className="rounded-[var(--radius-control)] border border-[var(--border)]"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
                  <span className="font-mono text-2xs text-[var(--muted)]">
                    {entry.timestamp ? formatTimestamp(entry.timestamp) : '—'}
                  </span>
                  {entry.taskName ? (
                    <Badge variant="secondary" size="sm">
                      {entry.taskName}
                    </Badge>
                  ) : null}
                  {entry.location ? (
                    <span className="font-mono text-2xs text-[var(--muted)]">{entry.location}</span>
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
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
