import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { Download, MoreHorizontal, RotateCcw, Trash2, Users } from 'lucide-react';
import {
  useConsumerGroupsPage,
  useDeleteConsumerGroup,
  useExportConsumerGroups,
} from '@/api/hooks/consumerGroups';
import type { ConsumerGroupSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { enumCodec, useUrlState } from '@/hooks/useUrlState';
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

const STATE_VALUES = STATES.map((s) => s.value);
const SORT_KEYS = [
  'groupId',
  'state',
  'memberCount',
  'topicCount',
  'partitionCount',
  'totalLag',
  'maxTimeLagMs',
  'coordinatorId',
  'protocol',
] as const;
type SortKey = (typeof SORT_KEYS)[number];
const ORDERS = ['asc', 'desc'] as const;
type Order = (typeof ORDERS)[number];

const URL_DEFAULTS = {
  q: '',
  state: 'all',
  page: 1,
  perPage: 50,
  sort: 'totalLag' as SortKey,
  order: 'desc' as Order,
};
const URL_CODECS = {
  state: enumCodec(STATE_VALUES, 'all'),
  sort: enumCodec(SORT_KEYS, 'totalLag'),
  order: enumCodec(ORDERS, 'desc'),
};

export function ConsumersPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const [{ q: search, state, page, perPage, sort, order }, setUrl] = useUrlState(URL_DEFAULTS, {
    codecs: URL_CODECS,
  });
  const debounced = useDebounced(search, 300);
  const sorting = useMemo<SortingState>(
    () => [{ id: sort, desc: order === 'desc' }],
    [sort, order],
  );
  const [deleteTarget, setDeleteTarget] = useState<ConsumerGroupSummary | null>(null);

  const { data, isLoading, error, refetch } = useConsumerGroupsPage(cluster, {
    search: debounced || undefined,
    state: state === 'all' ? undefined : state,
    page,
    perPage,
    sort,
    order,
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
        meta={data ? <Badge variant="secondary">{formatCompact(data.total)}</Badge> : null}
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
        data={data?.items ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={(v) => setUrl({ q: v, page: 1 })}
        searchPlaceholder="Search groups…"
        sorting={sorting}
        onSortingChange={(s) => {
          const next = s[0];
          const nextSort = (SORT_KEYS as readonly string[]).includes(next?.id ?? '')
            ? (next.id as SortKey)
            : 'totalLag';
          setUrl({ sort: nextSort, order: next?.desc ? 'desc' : 'asc', page: 1 });
        }}
        manualSorting
        page={page}
        perPage={perPage}
        total={data?.total ?? 0}
        onPageChange={(p) => setUrl({ page: p })}
        onPerPageChange={(n) => setUrl({ perPage: n, page: 1 })}
        getRowHref={(group) => `/c/${cluster}/consumers/${encodeURIComponent(group.groupId)}`}
        rowLabel="groups"
        caption="Consumer groups in this cluster with state, membership and lag"
        toolbar={
          <SimpleSelect
            className="w-48"
            value={state}
            onValueChange={(v) => setUrl({ state: v, page: 1 })}
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
              {!canEdit ? (
                <p className="px-2 py-1.5 text-2xs text-[var(--muted)]">{REQUIRES_EDITOR}</p>
              ) : null}
              <DropdownMenuItem
                disabled={!canEdit}
                title={canEdit ? undefined : REQUIRES_EDITOR}
                onSelect={() =>
                  void navigate(
                    `/c/${cluster}/consumers/${encodeURIComponent(group.groupId)}?tab=partitions`,
                  )
                }
              >
                <RotateCcw /> Reset offsets
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!canEdit}
                title={canEdit ? undefined : REQUIRES_EDITOR}
                onSelect={() => setDeleteTarget(group)}
              >
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
