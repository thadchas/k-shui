import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { PartitionDetail } from '@/api/types';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Tooltip } from '@/components/ui/tooltip';

function ReplicaList({ ids, isr }: { ids: number[]; isr: number[] }) {
  const isrSet = new Set(isr);
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const inSync = isrSet.has(id);
        return (
          <Tooltip key={id} content={inSync ? 'In sync' : 'Out of sync'}>
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-2xs tabular-nums',
                inSync
                  ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]'
                  : 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]',
              )}
            >
              {id}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
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
        meta: { numeric: true, label: 'Leader', widthClass: 'w-20' },
        cell: ({ row }) =>
          row.original.leader === null ? (
            <Badge variant="danger" size="sm">
              none
            </Badge>
          ) : (
            <span className="font-mono tabular-nums">{row.original.leader}</span>
          ),
      },
      {
        id: 'replicas',
        header: 'Replicas',
        meta: { label: 'Replicas' },
        cell: ({ row }) => <ReplicaList ids={row.original.replicas} isr={row.original.isr} />,
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
        meta: { numeric: true, label: 'Messages' },
        accessorFn: (row) => row.endOffset - row.beginOffset,
        cell: ({ row }) => formatNumber(row.original.endOffset - row.original.beginOffset),
      },
      {
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
    ],
    [],
  );

  return (
    <DataTable
      className={className}
      columns={columns}
      data={partitions ?? []}
      loading={loading}
      error={error}
      onRetry={onRetry}
      hideToolbar
      defaultSorting={[{ id: 'id', desc: false }]}
      onRowClick={onRowClick}
      emptyTitle="No partitions"
      rowLabel="partitions"
    />
  );
}
