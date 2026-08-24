import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, RotateCcw, Trash2, Users } from 'lucide-react';
import {
  useConsumerGroup,
  useConsumerGroupLagHistory,
  useDeleteConsumerGroup,
} from '@/api/hooks/consumerGroups';
import type { ConsumerGroupMember, ConsumerGroupPartition, TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
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
import { ResetOffsetsDialog } from './components/ResetOffsetsDialog';

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

export function ConsumerGroupDetailPage() {
  const cluster = useClusterId();
  const { group: groupParam = '' } = useParams<{ group: string }>();
  const group = decodeURIComponent(groupParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const [range, setRange] = useState<TimeRange>('1h');
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
        accessorKey: 'clientId',
        header: 'Client',
        meta: { label: 'Client' },
        cell: ({ row }) => (
          <span className="text-xs text-[var(--muted)]">{row.original.clientId ?? '—'}</span>
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
        accessorKey: 'memberId',
        header: 'Member ID',
        meta: { label: 'Member ID' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.memberId}</span>,
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
        header: 'Assignments',
        meta: { numeric: true, label: 'Assignments' },
        cell: ({ row }) => formatNumber(row.original.assignments?.length ?? 0),
      },
    ],
    [],
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
            <Button variant="secondary" onClick={() => setResetOpen(true)}>
              <RotateCcw /> Reset offsets
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 /> Delete
            </Button>
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
            hideToolbar
            defaultSorting={[{ id: 'lag', desc: true }]}
            rowLabel="partitions"
            emptyState={<EmptyState icon={Users} title="No partition assignments" />}
          />
        </TabsContent>

        <TabsContent value="members">
          <DataTable
            columns={memberColumns}
            data={data?.members ?? []}
            loading={detail.isLoading}
            hideToolbar
            rowLabel="members"
            emptyState={
              <EmptyState
                icon={Users}
                title="No active members"
                description="The group currently has no members."
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
