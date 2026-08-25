import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeft, ChevronDown, RotateCcw, Trash2, Users } from 'lucide-react';
import {
  useConsumerGroup,
  useConsumerGroupLagHistory,
  useDeleteConsumerGroup,
} from '@/api/hooks/consumerGroups';
import type { ConsumerGroupMember, ConsumerGroupPartition, TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { formatCompact, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { ResetOffsetsDialog } from './components/ResetOffsetsDialog';
import { TIME_LAG_WARN_MS, formatTimeLag } from './lag';

function LagBar({ lag, max }: { lag: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (lag / max) * 100) : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className={cn(
            'h-full rounded-full',
            pct > 66
              ? 'bg-[var(--danger)]'
              : pct > 25
                ? 'bg-[var(--warning)]'
                : 'bg-[var(--success)]',
          )}
          style={{ width: `${Math.max(pct, lag > 0 ? 4 : 0)}%` }}
        />
      </div>
      <span className="w-16 text-right font-mono text-[13px] tabular-nums">
        {formatCompact(lag)}
      </span>
    </div>
  );
}

/** Member assignments as topic-grouped partition chips. */
function AssignmentChips({ assignments }: { assignments: ConsumerGroupMember['assignments'] }) {
  const grouped = useMemo(() => {
    const byTopic = new Map<string, number[]>();
    for (const a of assignments ?? []) {
      const list = byTopic.get(a.topic) ?? [];
      list.push(a.partition);
      byTopic.set(a.topic, list);
    }
    return Array.from(byTopic.entries())
      .map(([topic, partitions]) => ({ topic, partitions: partitions.sort((a, b) => a - b) }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
  }, [assignments]);

  if (grouped.length === 0) {
    return <p className="text-xs text-[var(--muted)]">No partitions assigned.</p>;
  }
  return (
    <div className="space-y-1.5">
      {grouped.map(({ topic, partitions }) => (
        <div key={topic} className="flex flex-wrap items-center gap-1">
          <span className="mr-1 font-mono text-xs text-[var(--muted)]">{topic}</span>
          {partitions.map((p) => (
            <Badge key={p} variant="secondary" size="sm" className="font-mono tabular-nums">
              {p}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  );
}

/** How far a member's partition count sits from the group mean (rebalance skew hint). */
function SkewHint({ count, mean }: { count: number; mean: number }) {
  if (!Number.isFinite(mean) || mean <= 0) return <span className="text-[var(--muted)]">—</span>;
  const delta = count - mean;
  const skewed = Math.abs(delta) >= Math.max(1, mean * 0.25);
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        skewed ? 'text-[var(--warning)]' : 'text-[var(--muted)]',
      )}
      title={`${count} partitions vs mean ${mean.toFixed(1)} per member`}
    >
      {delta > 0 ? '+' : ''}
      {delta.toFixed(1)} vs mean
    </span>
  );
}

export function ConsumerGroupDetailPage() {
  const cluster = useClusterId();
  const { group: groupParam = '' } = useParams<{ group: string }>();
  const group = decodeURIComponent(groupParam);
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const [range, setRange] = useState<TimeRange>('1h');
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(() => new Set());

  const detail = useConsumerGroup(cluster, group);
  const lagHistory = useConsumerGroupLagHistory(cluster, group, { range });
  const deleteGroup = useDeleteConsumerGroup(cluster);

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const data = detail.data;
  const maxLag = useMemo(
    () => Math.max(0, ...(data?.partitions ?? []).map((p) => p.lag ?? 0)),
    [data],
  );

  const unassigned = useMemo(
    () => (data?.partitions ?? []).filter((p) => p.memberId === null || p.memberId === undefined),
    [data],
  );

  const meanAssignments = useMemo(() => {
    const members = data?.members ?? [];
    if (members.length === 0) return 0;
    return members.reduce((sum, m) => sum + (m.assignments?.length ?? 0), 0) / members.length;
  }, [data]);

  /** Group-total lag series (the entry without a topic label) drives the overview sparkline. */
  const totalLagPoints = useMemo(() => {
    const series = lagHistory.data?.series ?? [];
    const total = series.find((s) => !s.labels?.topic) ?? series[0];
    return total?.points;
  }, [lagHistory.data]);

  const toggleMember = (memberId: string) =>
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });

  const partitionColumns = useMemo<ColumnDef<ConsumerGroupPartition>[]>(
    () => [
      {
        accessorKey: 'topic',
        header: 'Topic',
        meta: { label: 'Topic' },
        cell: ({ row }) => (
          <Link
            to={`/c/${cluster}/topics/${encodeURIComponent(row.original.topic)}`}
            className="font-mono text-[13px] hover:text-[var(--primary)]"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.topic}
          </Link>
        ),
      },
      {
        accessorKey: 'partition',
        header: 'Partition',
        meta: { numeric: true, label: 'Partition' },
      },
      {
        accessorKey: 'currentOffset',
        header: 'Current offset',
        meta: { numeric: true, label: 'Current offset' },
        cell: ({ row }) => formatNumber(row.original.currentOffset),
      },
      {
        accessorKey: 'endOffset',
        header: 'End offset',
        meta: { numeric: true, label: 'End offset' },
        cell: ({ row }) => formatNumber(row.original.endOffset),
      },
      {
        accessorKey: 'lag',
        header: 'Lag',
        meta: { numeric: true, label: 'Lag', widthClass: 'w-44' },
        cell: ({ row }) => <LagBar lag={row.original.lag ?? 0} max={maxLag} />,
      },
      {
        accessorKey: 'timeLagMs',
        header: 'Lag (time)',
        meta: { numeric: true, label: 'Lag (time)' },
        sortUndefined: 'last',
        cell: ({ row }) => (
          <span
            title="Estimated time behind the log end (lag ÷ produce rate); — when the rate is unknown"
            className={
              (row.original.timeLagMs ?? 0) >= TIME_LAG_WARN_MS
                ? 'text-[var(--warning)]'
                : 'text-[var(--muted)]'
            }
          >
            {formatTimeLag(row.original.timeLagMs)}
          </span>
        ),
      },
      {
        accessorKey: 'clientId',
        header: 'Client',
        meta: { label: 'Client' },
        cell: ({ row }) =>
          row.original.clientId ? (
            <span className="text-xs text-[var(--muted)]">{row.original.clientId}</span>
          ) : (
            <Badge variant="warning" size="sm">
              unassigned
            </Badge>
          ),
      },
      {
        accessorKey: 'host',
        header: 'Host',
        meta: { label: 'Host' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.host ?? '—'}</span>,
      },
    ],
    [cluster, maxLag],
  );

  const memberColumns = useMemo<ColumnDef<ConsumerGroupMember>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        meta: { widthClass: 'w-8', stopRowClick: true },
        enableSorting: false,
        cell: ({ row }) => {
          const open = expandedMembers.has(row.original.memberId);
          return (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={open ? 'Collapse assignments' : 'Expand assignments'}
              aria-expanded={open}
              onClick={() => toggleMember(row.original.memberId)}
            >
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
            </Button>
          );
        },
      },
      {
        accessorKey: 'memberId',
        header: 'Member ID',
        meta: { label: 'Member ID' },
        cell: ({ row }) => {
          const open = expandedMembers.has(row.original.memberId);
          return (
            <div className="min-w-0 space-y-2">
              <span className="block truncate font-mono text-xs">{row.original.memberId}</span>
              {open ? (
                <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <AssignmentChips assignments={row.original.assignments} />
                </div>
              ) : null}
            </div>
          );
        },
      },
      { accessorKey: 'clientId', header: 'Client ID', meta: { label: 'Client ID' } },
      {
        accessorKey: 'host',
        header: 'Host',
        meta: { label: 'Host' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.host}</span>,
      },
      {
        id: 'assignments',
        header: 'Partitions',
        meta: { numeric: true, label: 'Partitions' },
        accessorFn: (row) => row.assignments?.length ?? 0,
        cell: ({ row }) => formatNumber(row.original.assignments?.length ?? 0),
      },
      {
        id: 'skew',
        header: 'Skew',
        meta: { numeric: true, label: 'Skew' },
        accessorFn: (row) => (row.assignments?.length ?? 0) - meanAssignments,
        cell: ({ row }) => (
          <SkewHint count={row.original.assignments?.length ?? 0} mean={meanAssignments} />
        ),
      },
    ],
    [expandedMembers, meanAssignments],
  );

  if (detail.error) {
    return (
      <div>
        <PageHeader title={group} />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{group}</span>}
        description={
          data ? `${data.groupType} group · coordinator ${data.coordinatorId ?? '—'}` : undefined
        }
        meta={data ? <StatusPill status={data.state} /> : null}
        actions={
          <>
            <Button variant="outline" onClick={() => void navigate(`/c/${cluster}/consumers`)}>
              <ArrowLeft /> All groups
            </Button>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button variant="secondary" disabled={!canEdit} onClick={() => setResetOpen(true)}>
                  <RotateCcw /> Reset offsets
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button
                  variant="destructive"
                  disabled={!canEdit}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 /> Delete
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="partitions">Partitions</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="lag">Lag chart</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <StatTileRow columns={4}>
            <StatTile
              label="State"
              loading={detail.isLoading}
              value={<span className="text-xl">{data?.state ?? '—'}</span>}
            />
            <StatTile
              label="Members"
              loading={detail.isLoading}
              value={formatNumber(data?.memberCount)}
              hint={
                unassigned.length > 0
                  ? `${unassigned.length} partition${unassigned.length === 1 ? '' : 's'} unassigned`
                  : undefined
              }
              tone={unassigned.length > 0 ? 'warning' : undefined}
            />
            <StatTile
              label="Topics"
              loading={detail.isLoading}
              value={formatNumber(data?.topicCount)}
            />
            <StatTile
              label="Total lag"
              loading={detail.isLoading}
              value={formatCompact(data?.totalLag)}
              tone={(data?.totalLag ?? 0) > 0 ? 'warning' : 'success'}
              points={totalLagPoints}
              hint={
                data?.maxTimeLagMs !== null && data?.maxTimeLagMs !== undefined
                  ? `≈ ${formatTimeLag(data.maxTimeLagMs)} behind (slowest partition)`
                  : `Last ${range}`
              }
            />
          </StatTileRow>

          <Card>
            <CardToolbarHeader title="Topics" description="Lag broken down by topic" />
            <CardContent>
              {!data?.topicsSummary || data.topicsSummary.length === 0 ? (
                <EmptyState compact icon={Users} title="No topic assignments" />
              ) : (
                <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Topic</TableHead>
                        <TableHead numeric>Partitions</TableHead>
                        <TableHead numeric>Lag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topicsSummary.map((t) => (
                        <TableRow
                          key={t.topic}
                          clickable
                          onClick={() =>
                            void navigate(`/c/${cluster}/topics/${encodeURIComponent(t.topic)}`)
                          }
                        >
                          <TableCell className="font-mono text-[13px]">{t.topic}</TableCell>
                          <TableCell numeric>{t.partitions}</TableCell>
                          <TableCell
                            numeric
                            className={t.lag > 0 ? 'text-[var(--warning)]' : undefined}
                          >
                            {formatCompact(t.lag)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partitions">
          <DataTable
            columns={partitionColumns}
            data={data?.partitions ?? []}
            loading={detail.isLoading}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            hideToolbar
            defaultSorting={[{ id: 'lag', desc: true }]}
            rowLabel="partitions"
            caption={`Partition assignments and lag for consumer group ${group}`}
            emptyState={<EmptyState icon={Users} title="No partition assignments" />}
          />
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          {unassigned.length > 0 ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-xs text-[var(--foreground)]">
                  {unassigned.length} committed partition{unassigned.length === 1 ? '' : 's'}{' '}
                  {unassigned.length === 1 ? 'has' : 'have'} no active member — lag there will grow
                  until a consumer picks {unassigned.length === 1 ? 'it' : 'them'} up.
                </p>
                <div className="flex flex-wrap gap-1">
                  {unassigned.slice(0, 40).map((p) => (
                    <Badge
                      key={`${p.topic}-${p.partition}`}
                      variant="outline"
                      size="sm"
                      className="font-mono"
                    >
                      {p.topic}-{p.partition}
                    </Badge>
                  ))}
                  {unassigned.length > 40 ? (
                    <Badge variant="secondary" size="sm">
                      +{unassigned.length - 40} more
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <DataTable
            columns={memberColumns}
            data={data?.members ?? []}
            loading={detail.isLoading}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            globalFilter={memberSearch}
            onGlobalFilterChange={setMemberSearch}
            searchPlaceholder="Search members, clients, hosts…"
            getRowId={(row) => row.memberId}
            onRowClick={(row) => toggleMember(row.memberId)}
            isRowSelected={(row) => expandedMembers.has(row.memberId)}
            rowLabel="members"
            caption={`Active members of consumer group ${group}`}
            emptyState={
              <EmptyState
                icon={Users}
                title={memberSearch ? 'No members match' : 'No active members'}
                description={
                  memberSearch ? 'Try a different search.' : 'The group currently has no members.'
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="lag" className="space-y-4">
          <div className="flex justify-end">
            <TimeRangePicker value={range} onValueChange={setRange} />
          </div>
          <Card>
            <CardToolbarHeader title="Consumer lag over time" description="Per-topic lag history" />
            <CardContent>
              <TimeSeriesChart
                series={lagHistory.data?.series}
                unit="count"
                height={300}
                loading={lagHistory.isLoading}
                error={lagHistory.error}
                onRetry={() => void lagHistory.refetch()}
                area={false}
                emptyMessage="No lag history recorded for this range."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ResetOffsetsDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        cluster={cluster}
        group={group}
        detail={data}
      />

      <ConfirmDestructiveDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete consumer group"
        description={
          <>
            Removes <span className="font-mono">{group}</span> and all of its committed offsets.
          </>
        }
        confirmText={group}
        confirmLabel="Delete group"
        loading={deleteGroup.isPending}
        onConfirm={async () => {
          try {
            await deleteGroup.mutateAsync(group);
            toast.success('Group deleted');
            void navigate(`/c/${cluster}/consumers`);
          } catch (e) {
            toastError('Failed to delete group', e);
          }
        }}
      />
    </div>
  );
}

export default ConsumerGroupDetailPage;
