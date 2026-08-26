import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Server } from 'lucide-react';
import { useFlinkTaskManagerList } from '@/api/hooks/flink';
import type { FlinkTaskManagerDetail } from '@/api/types';
import { formatBytes, formatRelative } from '@/lib/format';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskManagerDrawer } from './TaskManagerDrawer';
import { UsageBar } from './TaskStatusBar';

export interface TaskManagersTableProps {
  cluster: string;
  flinkCluster: string;
}

export function TaskManagersTable({ cluster, flinkCluster }: TaskManagersTableProps) {
  const { data, isLoading, error, refetch } = useFlinkTaskManagerList(cluster, flinkCluster);
  const [selected, setSelected] = useState<FlinkTaskManagerDetail | null>(null);
  const [search, setSearch] = useState('');

  const columns = useMemo<ColumnDef<FlinkTaskManagerDetail>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'Task manager',
        meta: { label: 'Task manager' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-medium">{row.original.id}</p>
            <p className="truncate text-2xs text-[var(--muted)]">{row.original.path}</p>
          </div>
        ),
      },
      {
        id: 'slots',
        header: 'Slots',
        meta: { label: 'Slots', widthClass: 'w-48' },
        accessorFn: (row) => row.slotsNumber - row.freeSlots,
        cell: ({ row }) => (
          <UsageBar
            used={row.original.slotsNumber - row.original.freeSlots}
            total={row.original.slotsNumber}
          />
        ),
      },
      {
        id: 'cpu',
        header: 'Cores',
        meta: { numeric: true, label: 'Cores', widthClass: 'w-20' },
        accessorFn: (row) => row.hardware?.cpuCores ?? 0,
        cell: ({ row }) => row.original.hardware?.cpuCores ?? '—',
      },
      {
        id: 'memory',
        header: 'Physical memory',
        meta: { numeric: true, label: 'Physical memory', widthClass: 'w-36' },
        accessorFn: (row) => row.hardware?.physicalMemory ?? 0,
        cell: ({ row }) => formatBytes(row.original.hardware?.physicalMemory),
      },
      {
        id: 'managed',
        header: 'Managed memory',
        meta: { numeric: true, label: 'Managed memory', widthClass: 'w-36' },
        accessorFn: (row) => row.memoryConfiguration?.managedMemory ?? 0,
        cell: ({ row }) => formatBytes(row.original.memoryConfiguration?.managedMemory),
      },
      {
        accessorKey: 'dataPort',
        header: 'Data port',
        meta: { numeric: true, label: 'Data port', widthClass: 'w-28' },
      },
      {
        id: 'heartbeat',
        header: 'Last heartbeat',
        meta: { label: 'Last heartbeat', widthClass: 'w-36' },
        accessorFn: (row) => row.timeSinceLastHeartbeat ?? 0,
        cell: ({ row }) => (
          <span className="text-2xs text-[var(--muted)]">
            {row.original.timeSinceLastHeartbeat
              ? formatRelative(row.original.timeSinceLastHeartbeat)
              : '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search task managers…"
        caption="Flink task managers"
        rowLabel="task managers"
        onRowClick={(tm) => setSelected(tm)}
        isRowSelected={(tm) => tm.id === selected?.id}
        emptyState={
          <EmptyState
            icon={Server}
            title="No task managers"
            description="The session cluster has no registered task managers — check the Flink deployment."
          />
        }
      />
      <TaskManagerDrawer
        cluster={cluster}
        flinkCluster={flinkCluster}
        taskManager={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
