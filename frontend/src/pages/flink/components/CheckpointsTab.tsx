import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CircleCheck, CircleX, Save, Timer } from 'lucide-react';
import { useFlinkCheckpointConfig, useFlinkCheckpointsFull } from '@/api/hooks/flink';
import type { FlinkCheckpointEntry } from '@/api/types';
import { formatBytes, formatDuration, formatMs, formatNumber, formatTimestamp } from '@/lib/format';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CodeInline } from '@/components/ui/code-block';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-2 last:border-0">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="text-right font-mono text-xs tabular-nums text-[var(--foreground)]">
        {value}
      </span>
    </div>
  );
}

export function CheckpointsTab({
  cluster,
  flinkCluster,
  jid,
}: {
  cluster: string;
  flinkCluster: string;
  jid: string;
}) {
  const checkpoints = useFlinkCheckpointsFull(cluster, flinkCluster, jid);
  const config = useFlinkCheckpointConfig(cluster, flinkCluster, jid);

  const data = checkpoints.data;
  const latest = data?.latest?.completed ?? null;
  const counts = data?.counts;

  const columns = useMemo<ColumnDef<FlinkCheckpointEntry>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        meta: { numeric: true, label: 'ID', widthClass: 'w-20' },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { label: 'Status', widthClass: 'w-32' },
        cell: ({ row }) => (
          <StatusPill
            status={row.original.status}
            tone={
              row.original.status === 'COMPLETED'
                ? 'success'
                : row.original.status === 'FAILED'
                  ? 'danger'
                  : 'warning'
            }
            label={row.original.status.toLowerCase()}
          />
        ),
      },
      {
        id: 'kind',
        header: 'Type',
        meta: { label: 'Type', widthClass: 'w-28' },
        cell: ({ row }) => (
          <Badge variant={row.original.isSavepoint ? 'accent' : 'secondary'} size="sm">
            {row.original.isSavepoint ? 'savepoint' : (row.original.checkpointType ?? 'checkpoint')}
          </Badge>
        ),
      },
      {
        accessorKey: 'triggerTimestamp',
        header: 'Triggered',
        meta: { label: 'Triggered', widthClass: 'w-44' },
        cell: ({ row }) => (
          <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
            {formatTimestamp(row.original.triggerTimestamp)}
          </span>
        ),
      },
      {
        accessorKey: 'endToEndDuration',
        header: 'Duration',
        meta: { numeric: true, label: 'Duration', widthClass: 'w-28' },
        cell: ({ row }) => formatMs(row.original.endToEndDuration),
      },
      {
        accessorKey: 'stateSize',
        header: 'State size',
        meta: { numeric: true, label: 'State size', widthClass: 'w-28' },
        cell: ({ row }) => formatBytes(row.original.stateSize),
      },
      {
        id: 'acked',
        header: 'Acked',
        meta: { numeric: true, label: 'Acked', widthClass: 'w-24' },
        cell: ({ row }) =>
          row.original.numSubtasks
            ? `${row.original.numAcknowledgedSubtasks ?? 0}/${row.original.numSubtasks}`
            : '—',
      },
    ],
    [],
  );

  if (checkpoints.error) {
    return <InlineError error={checkpoints.error} onRetry={() => void checkpoints.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <StatTileRow columns={5}>
        <StatTile
          label="Completed"
          value={formatNumber(counts?.completed)}
          tone="success"
          icon={CircleCheck}
          loading={checkpoints.isLoading}
        />
        <StatTile
          label="Failed"
          value={formatNumber(counts?.failed)}
          tone={(counts?.failed ?? 0) > 0 ? 'danger' : 'muted'}
          icon={CircleX}
          loading={checkpoints.isLoading}
        />
        <StatTile
          label="In progress"
          value={formatNumber(counts?.inProgress)}
          icon={Timer}
          loading={checkpoints.isLoading}
        />
        <StatTile
          label="Latest size"
          value={formatBytes(latest?.stateSize)}
          icon={Save}
          hint={latest ? `checkpoint ${latest.id}` : undefined}
          loading={checkpoints.isLoading}
        />
        <StatTile
          label="Latest duration"
          value={formatMs(latest?.endToEndDuration)}
          icon={Timer}
          hint={latest ? formatTimestamp(latest.latestAckTimestamp) : undefined}
          loading={checkpoints.isLoading}
        />
      </StatTileRow>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardToolbarHeader title="Configuration" description="Checkpointing settings" />
          <CardContent>
            {config.error ? (
              <InlineError error={config.error} onRetry={() => void config.refetch()} />
            ) : config.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : config.data ? (
              <div>
                <ConfigRow label="Mode" value={config.data.mode ?? '—'} />
                <ConfigRow label="Interval" value={formatDuration(config.data.interval)} />
                <ConfigRow label="Timeout" value={formatDuration(config.data.timeout)} />
                <ConfigRow label="Min pause" value={formatDuration(config.data.minPause)} />
                <ConfigRow label="Max concurrent" value={config.data.maxConcurrent ?? '—'} />
                <ConfigRow
                  label="Unaligned"
                  value={config.data.unalignedCheckpoints ? 'yes' : 'no'}
                />
                <ConfigRow
                  label="Retained on cancel"
                  value={
                    config.data.externalization?.enabled
                      ? config.data.externalization.deleteOnCancellation
                        ? 'deleted'
                        : 'retained'
                      : 'disabled'
                  }
                />
                <ConfigRow label="State backend" value={config.data.stateBackend ?? '—'} />
                <ConfigRow label="Storage" value={config.data.checkpointStorage ?? '—'} />
                <ConfigRow
                  label="Tolerable failures"
                  value={config.data.tolerableFailedCheckpoints ?? '—'}
                />
              </div>
            ) : (
              <EmptyState compact title="No checkpoint config" />
            )}
            {latest?.externalPath ? (
              <div className="mt-3 space-y-1">
                <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Latest external path
                </p>
                <CodeInline className="break-all">{latest.externalPath}</CodeInline>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardToolbarHeader
            title="History"
            description={`${data?.history?.length ?? 0} recent checkpoints`}
            actions={
              counts ? <Badge variant="secondary">{formatNumber(counts.total)} total</Badge> : null
            }
          />
          <CardContent>
            <DataTable
              columns={columns}
              data={data?.history ?? []}
              loading={checkpoints.isLoading}
              hideToolbar
              rowLabel="checkpoints"
              caption="Checkpoint history"
              maxHeight={420}
              defaultSorting={[{ id: 'id', desc: true }]}
              emptyState={
                <EmptyState
                  compact
                  icon={Save}
                  title="No checkpoints yet"
                  description="Checkpointing may be disabled for this job."
                />
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
