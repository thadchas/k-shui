import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Crown } from 'lucide-react';
import type { PartitionDetail } from '@/api/types';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';

function ReplicaList({
  ids,
  isr,
  leader,
}: {
  ids: number[];
  isr: number[];
  leader: number | null;
}) {
  const isrSet = new Set(isr);
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id, index) => {
        const inSync = isrSet.has(id);
        const preferred = index === 0;
        const isLeader = id === leader;
        const tip = [
          inSync ? 'In sync' : 'Out of sync',
          preferred ? 'preferred leader' : null,
          isLeader ? 'current leader' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Tooltip key={id} content={tip}>
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded px-1 font-mono text-2xs tabular-nums',
                inSync
                  ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]'
                  : 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]',
                isLeader && 'ring-1 ring-current',
              )}
            >
              {preferred ? <Crown className="size-2.5" aria-label="Preferred leader" /> : null}
              {id}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function isPartitionUnhealthy(p: PartitionDetail): boolean {
  return p.leader === null || p.isr.length < p.replicas.length;
}

export interface PartitionsTableProps {
  partitions: PartitionDetail[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  onRowClick?: (partition: PartitionDetail) => void;
}

export function PartitionsTable({
  partitions,
  loading,
  error,
  onRetry,
  className,
  onRowClick,
}: PartitionsTableProps) {
  const [onlyUnhealthy, setOnlyUnhealthy] = useState(false);

  const totalMessages = useMemo(
    () => (partitions ?? []).reduce((acc, p) => acc + Math.max(0, p.endOffset - p.beginOffset), 0),
    [partitions],
  );
  const unhealthyCount = useMemo(
    () => (partitions ?? []).filter(isPartitionUnhealthy).length,
    [partitions],
  );

  const rows = useMemo(
    () => (onlyUnhealthy ? (partitions ?? []).filter(isPartitionUnhealthy) : (partitions ?? [])),
    [partitions, onlyUnhealthy],
  );

  const columns = useMemo<ColumnDef<PartitionDetail>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'Partition',
        meta: { numeric: true, label: 'Partition', widthClass: 'w-24' },
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.id}</span>,
      },
      {
        accessorKey: 'leader',
        header: 'Leader',
        meta: { numeric: true, label: 'Leader', widthClass: 'w-36' },
        cell: ({ row }) => {
          const { leader, replicas } = row.original;
          if (leader === null) {
            return (
              <Badge variant="danger" size="sm">
                none
              </Badge>
            );
          }
          const preferred = replicas[0];
          const notPreferred = preferred !== undefined && leader !== preferred;
          return (
            <span className="inline-flex items-center justify-end gap-1.5">
              <span className="font-mono tabular-nums">{leader}</span>
              {notPreferred ? (
                <Tooltip
                  content={`Preferred leader is broker ${preferred}. Run a preferred leader election to rebalance.`}
                >
                  <Badge variant="warning" size="sm">
                    not preferred
                  </Badge>
                </Tooltip>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'replicas',
        header: 'Replicas',
        meta: { label: 'Replicas' },
        cell: ({ row }) => (
          <ReplicaList
            ids={row.original.replicas}
            isr={row.original.isr}
            leader={row.original.leader}
          />
        ),
      },
      {
        id: 'isr',
        header: 'ISR',
        meta: { numeric: true, label: 'ISR' },
        cell: ({ row }) => {
          const under = row.original.isr.length < row.original.replicas.length;
          return (
            <span className={cn('font-mono tabular-nums', under && 'text-[var(--warning)]')}>
              {row.original.isr.length}/{row.original.replicas.length}
            </span>
          );
        },
      },
      {
        accessorKey: 'beginOffset',
        header: 'Begin offset',
        meta: { numeric: true, label: 'Begin offset' },
        cell: ({ row }) => formatNumber(row.original.beginOffset),
      },
      {
        accessorKey: 'endOffset',
        header: 'End offset',
        meta: { numeric: true, label: 'End offset' },
        cell: ({ row }) => formatNumber(row.original.endOffset),
      },
      {
        id: 'messages',
        header: 'Messages',
        meta: { numeric: true, label: 'Messages', widthClass: 'w-44' },
        accessorFn: (row) => row.endOffset - row.beginOffset,
        cell: ({ row }) => {
          const count = Math.max(0, row.original.endOffset - row.original.beginOffset);
          const pct = totalMessages > 0 ? (count / totalMessages) * 100 : 0;
          return (
            <span className="inline-flex items-center justify-end gap-2">
              <span className="font-mono tabular-nums">{formatNumber(count)}</span>
              <Tooltip content={`${pct.toFixed(1)}% of topic`}>
                <span
                  className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]"
                  role="img"
                  aria-label={`${pct.toFixed(1)} percent of topic`}
                >
                  <span
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%` }}
                  />
                </span>
              </Tooltip>
              <span className="w-10 text-right font-mono text-2xs tabular-nums text-[var(--muted)]">
                {pct.toFixed(pct < 10 ? 1 : 0)}%
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
    ],
    [totalMessages],
  );

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-end gap-3">
        {unhealthyCount > 0 ? (
          <Badge variant="warning" size="sm">
            {unhealthyCount} unhealthy
          </Badge>
        ) : null}
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--muted)]">
          <Switch
            checked={onlyUnhealthy}
            onCheckedChange={setOnlyUnhealthy}
            aria-label="Only show unhealthy partitions"
          />
          Only unhealthy
        </label>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        hideToolbar
        defaultSorting={[{ id: 'id', desc: false }]}
        onRowClick={onRowClick}
        emptyTitle={onlyUnhealthy ? 'All partitions healthy' : 'No partitions'}
        emptyDescription={
          onlyUnhealthy ? 'Every partition has a leader and a full in-sync set.' : undefined
        }
        rowLabel="partitions"
      />
    </div>
  );
}
