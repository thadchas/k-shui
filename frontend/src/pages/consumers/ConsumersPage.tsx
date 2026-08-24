import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, MoreHorizontal, RotateCcw, Trash2, Users } from 'lucide-react';
import {
  useConsumerGroups,
  useDeleteConsumerGroup,
  useExportConsumerGroups,
} from '@/api/hooks/consumerGroups';
import type { ConsumerGroupSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { formatCompact } from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { toast, toastError } from '@/components/ui/toast';
import { TIME_LAG_WARN_MS, formatTimeLag } from './lag';

const STATES = [
  { label: 'All states', value: 'all' },
  { label: 'Stable', value: 'Stable' },
  { label: 'Empty', value: 'Empty' },
  { label: 'PreparingRebalance', value: 'PreparingRebalance' },
  { label: 'CompletingRebalance', value: 'CompletingRebalance' },
  { label: 'Dead', value: 'Dead' },
];

export function ConsumersPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [state, setState] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<ConsumerGroupSummary | null>(null);

  const { data, isLoading, error, refetch } = useConsumerGroups(cluster, {
    search: debounced || undefined,
    state: state === 'all' ? undefined : state,
  });
  const deleteGroup = useDeleteConsumerGroup(cluster);
  const exportCsv = useExportConsumerGroups(cluster);

  const columns = useMemo<ColumnDef<ConsumerGroupSummary>[]>(
    () => [
      {
        accessorKey: 'groupId',
        header: 'Group',
        meta: { label: 'Group' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium">
              {row.original.groupId}
            </span>
            {row.original.groupType && row.original.groupType !== 'classic' ? (
              <Badge variant="secondary" size="sm">
                {row.original.groupType}
              </Badge>
            ) : null}
            {row.original.isSimple ? (
              <Badge variant="outline" size="sm">
                simple
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        meta: { label: 'State', widthClass: 'w-44' },
        cell: ({ row }) => <StatusPill status={row.original.state} />,
      },
      {
        accessorKey: 'memberCount',
        header: 'Members',
        meta: { numeric: true, label: 'Members' },
        cell: ({ row }) => formatCompact(row.original.memberCount),
      },
      {
        accessorKey: 'topicCount',
        header: 'Topics',
        meta: { numeric: true, label: 'Topics' },
        cell: ({ row }) => formatCompact(row.original.topicCount),
      },
      {
        accessorKey: 'partitionCount',
        header: 'Partitions',
        meta: { numeric: true, label: 'Partitions' },
        cell: ({ row }) => formatCompact(row.original.partitionCount),
      },
      {
        accessorKey: 'totalLag',
        header: 'Lag',
        meta: { numeric: true, label: 'Total lag' },
        cell: ({ row }) => (
          <span className={row.original.totalLag > 0 ? 'text-[var(--warning)]' : undefined}>
            {formatCompact(row.original.totalLag)}
          </span>
        ),
      },
      {
        accessorKey: 'maxTimeLagMs',
        header: 'Lag (time)',
        meta: { numeric: true, label: 'Lag (time)' },
        sortUndefined: 'last',
        cell: ({ row }) => (
          <span
            title="Estimated time behind the log end for the slowest partition (lag ÷ produce rate)"
            className={
              (row.original.maxTimeLagMs ?? 0) >= TIME_LAG_WARN_MS
                ? 'text-[var(--warning)]'
                : 'text-[var(--muted)]'
            }
          >
            {formatTimeLag(row.original.maxTimeLagMs)}
          </span>
        ),
      },
      {
        accessorKey: 'coordinatorId',
        header: 'Coordinator',
        meta: { numeric: true, label: 'Coordinator' },
        cell: ({ row }) => row.original.coordinatorId ?? '—',
      },
      {
        accessorKey: 'protocol',
        header: 'Protocol',
        meta: { label: 'Protocol' },
        cell: ({ row }) => (
          <span className="text-xs text-[var(--muted)]">{row.original.protocol ?? '—'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        title="Consumer groups"
        description="Group state, membership and lag across the cluster."
        meta={data ? <Badge variant="secondary">{data.length}</Badge> : null}
        actions={
          <Button
            variant="outline"
            loading={exportCsv.isPending}
            onClick={() =>
              exportCsv.mutate(undefined, { onError: (e) => toastError('Export failed', e) })
            }
          >
            <Download /> Export CSV
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search groups…"
        defaultSorting={[{ id: 'totalLag', desc: true }]}
        onRowClick={(group) =>
          void navigate(`/c/${cluster}/consumers/${encodeURIComponent(group.groupId)}`)
        }
        rowLabel="groups"
        toolbar={
          <SimpleSelect
            className="w-48"
            value={state}
            onValueChange={setState}
            options={STATES}
            aria-label="Filter by state"
          />
        }
        rowActions={(group) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${group.groupId}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() =>
                  void navigate(
                    `/c/${cluster}/consumers/${encodeURIComponent(group.groupId)}?tab=partitions`,
                  )
                }
              >
                <RotateCcw /> Reset offsets
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDeleteTarget(group)}>
                <Trash2 /> Delete group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={Users}
            title={search || state !== 'all' ? 'No groups match' : 'No consumer groups'}
            description={
              search || state !== 'all'
                ? 'Try clearing the search or state filter.'
                : 'Consumer groups appear here once an application starts consuming.'
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete consumer group"
        description={
          <>
            Removes <span className="font-mono">{deleteTarget?.groupId}</span> and its committed
            offsets. The group must have no active members.
          </>
        }
        confirmText={deleteTarget?.groupId}
        confirmLabel="Delete group"
        loading={deleteGroup.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteGroup.mutateAsync(deleteTarget.groupId);
            toast.success(`Group ${deleteTarget.groupId} deleted`);
            setDeleteTarget(null);
          } catch (e) {
            toastError('Failed to delete group', e);
          }
        }}
      />
    </div>
  );
}

export default ConsumersPage;
