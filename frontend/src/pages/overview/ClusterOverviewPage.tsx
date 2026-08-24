import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Activity,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Crown,
  Layers,
  Server,
  ShieldAlert,
  Tag,
  Users,
} from 'lucide-react';
import {
  useCluster,
  useClusterHealth,
  useKRaftQuorum,
  useOverviewMetrics,
  useUnhealthyPartitions,
} from '@/api/hooks/clusters';
import { useConsumerGroups } from '@/api/hooks/consumerGroups';
import type { TimeRange, UnhealthyPartition, UnhealthyPartitionReason } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { pickSeries } from '@/lib/charts';
import { formatCompact, formatNumber } from '@/lib/format';
import { HealthChecks } from '@/components/HealthChecks';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CodeInline } from '@/components/ui/code-block';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, InlineError } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TimeRangePicker } from '@/components/ui/time-range-picker';

const REASON_LABEL: Record<
  UnhealthyPartitionReason,
  { label: string; variant: 'danger' | 'warning' | 'info' }
> = {
  offline: { label: 'offline', variant: 'danger' },
  underReplicated: { label: 'under-replicated', variant: 'warning' },
  nonPreferredLeader: { label: 'non-preferred leader', variant: 'info' },
};

const PANEL_ROWS = 6;
const TOP_GROUPS = 5;

function ReplicaList({ ids, isr }: { ids: number[]; isr?: number[] }) {
  if (ids.length === 0) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => {
        const inSync = isr ? isr.includes(id) : true;
        return (
          <span
            key={id}
            className={
              inSync
                ? 'font-mono text-xs tabular-nums'
                : 'font-mono text-xs tabular-nums text-[var(--danger)] line-through'
            }
            title={inSync ? undefined : `broker ${id} is out of sync`}
          >
            {id}
          </span>
        );
      })}
    </span>
  );
}

function ReasonBadges({ reasons }: { reasons: UnhealthyPartitionReason[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r} variant={REASON_LABEL[r]?.variant ?? 'secondary'} size="sm">
          {REASON_LABEL[r]?.label ?? r}
        </Badge>
      ))}
    </span>
  );
}

export function ClusterOverviewPage() {
  const cluster = useClusterId();
  const [range, setRange] = useState<TimeRange>('1h');
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthSearch, setHealthSearch] = useState('');

  const detail = useCluster(cluster);
  const health = useClusterHealth(cluster);
  const metrics = useOverviewMetrics(cluster, { range });
  const quorum = useKRaftQuorum(cluster);
  const unhealthy = useUnhealthyPartitions(cluster);
  const groups = useConsumerGroups(cluster);

  const data = detail.data;
  const series = metrics.data?.series;

  const topGroups = useMemo(
    () =>
      [...(groups.data ?? [])]
        .filter((g) => g.totalLag > 0)
        .sort((a, b) => b.totalLag - a.totalLag)
        .slice(0, TOP_GROUPS),
    [groups.data],
  );

  const partitionColumns = useMemo<ColumnDef<UnhealthyPartition>[]>(
    () => [
      {
        accessorKey: 'topic',
        header: 'Topic',
        meta: { label: 'Topic' },
        cell: ({ row }) => (
          <Link
            to={`/c/${cluster}/topics/${encodeURIComponent(row.original.topic)}?tab=partitions`}
            className="font-mono text-[13px] hover:text-[var(--primary)]"
          >
            {row.original.topic}
          </Link>
        ),
      },
      {
        accessorKey: 'partition',
        header: 'Partition',
        meta: { numeric: true, label: 'Partition', widthClass: 'w-24' },
      },
      {
        accessorKey: 'leader',
        header: 'Leader',
        meta: { numeric: true, label: 'Leader', widthClass: 'w-20' },
        cell: ({ row }) =>
          row.original.leader === null ? (
            <span className="text-[var(--danger)]">none</span>
          ) : (
            row.original.leader
          ),
      },
      {
        id: 'replicas',
        header: 'Replicas',
        meta: { label: 'Replicas' },
        accessorFn: (row) => row.replicas.join(','),
        cell: ({ row }) => <ReplicaList ids={row.original.replicas} isr={row.original.isr} />,
      },
      {
        id: 'isr',
        header: 'ISR',
        meta: { label: 'ISR' },
        accessorFn: (row) => `${row.isr.length}/${row.replicas.length}`,
        cell: ({ row }) => (
          <span
            className={
              row.original.isr.length < row.original.replicas.length
                ? 'font-mono text-xs tabular-nums text-[var(--warning)]'
                : 'font-mono text-xs tabular-nums'
            }
          >
            {row.original.isr.length}/{row.original.replicas.length}
          </span>
        ),
      },
      {
        id: 'reasons',
        header: 'Reason',
        meta: { label: 'Reason' },
        accessorFn: (row) => row.reasons.join(' '),
        cell: ({ row }) => <ReasonBadges reasons={row.original.reasons} />,
      },
    ],
    [cluster],
  );

  if (detail.error) {
    return (
      <div>
        <PageHeader title="Overview" />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const brokersDown = (data?.brokerCount ?? 0) - (data?.onlineBrokers ?? 0);
  const unhealthyItems = unhealthy.data?.items ?? [];
  const openHealth = () => setHealthOpen(true);

  return (
    <div className="space-y-6">
      <PageHeader
        title={data?.name ?? cluster}
        description={data?.clusterId ? `Kafka cluster id ${data.clusterId}` : 'Cluster overview'}
        meta={data ? <StatusPill status={data.status} /> : null}
        actions={<TimeRangePicker value={range} onValueChange={setRange} />}
      />

      <StatTileRow columns={4}>
        <StatTile
          label="Brokers online"
          loading={detail.isLoading}
          value={data ? `${data.onlineBrokers}/${data.brokerCount}` : '—'}
          tone={brokersDown > 0 ? 'danger' : 'success'}
          icon={Server}
        />
        <StatTile
          label="Topics"
          loading={detail.isLoading}
          value={formatCompact(data?.topicCount)}
          icon={Layers}
        />
        <StatTile
          label="Partitions"
          loading={detail.isLoading}
          value={formatCompact(data?.partitionCount)}
          icon={Boxes}
        />
        <StatTile
          label="Under-replicated"
          loading={detail.isLoading}
          value={formatNumber(data?.underReplicatedPartitions)}
          tone={(data?.underReplicatedPartitions ?? 0) > 0 ? 'warning' : 'success'}
          icon={Activity}
          onClick={openHealth}
          tooltip="Open partition health"
        />
        <StatTile
          label="Offline partitions"
          loading={detail.isLoading}
          value={formatNumber(data?.offlinePartitions)}
          tone={(data?.offlinePartitions ?? 0) > 0 ? 'danger' : 'success'}
          icon={ShieldAlert}
          onClick={openHealth}
          tooltip="Open partition health"
        />
        <StatTile
          label="Controller"
          loading={detail.isLoading}
          value={data?.controllerId ?? '—'}
          icon={Crown}
          hint={data?.kraft ? 'KRaft mode' : undefined}
        />
        <StatTile
          label="Kafka version"
          loading={detail.isLoading}
          value={<span className="text-xl">{data?.version ?? '—'}</span>}
          icon={Tag}
        />
        <StatTile
          label="In-sync replicas"
          loading={detail.isLoading}
          value={
            data?.inSyncReplicasPct !== null && data?.inSyncReplicasPct !== undefined
              ? `${data.inSyncReplicasPct.toFixed(1)}%`
              : '—'
          }
          tone={(data?.inSyncReplicasPct ?? 100) < 100 ? 'warning' : 'success'}
          icon={Activity}
        />
      </StatTileRow>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardToolbarHeader title="Throughput" description="Bytes in / out across all brokers" />
          <CardContent>
            <TimeSeriesChart
              series={pickSeries(series, ['bytesIn', 'bytesOut'])}
              unit="bytes/s"
              loading={metrics.isLoading}
              error={metrics.error}
              onRetry={() => void metrics.refetch()}
              labels={{ bytesIn: 'Bytes in', bytesOut: 'Bytes out' }}
              height={220}
            />
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader title="Messages in" description="Records produced per second" />
          <CardContent>
            <TimeSeriesChart
              series={pickSeries(series, ['messagesIn'])}
              unit="msg/s"
              loading={metrics.isLoading}
              error={metrics.error}
              onRetry={() => void metrics.refetch()}
              labels={{ messagesIn: 'Messages in' }}
              colorOffset={4}
              height={220}
            />
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader title="Request rate" description="Broker request handler throughput" />
          <CardContent>
            <TimeSeriesChart
              series={pickSeries(series, ['requestRate'])}
              unit="req/s"
              loading={metrics.isLoading}
              error={metrics.error}
              labels={{ requestRate: 'Requests' }}
              colorOffset={1}
              height={220}
            />
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader
            title="Replication health"
            description="Under-replicated and offline partitions"
          />
          <CardContent>
            <TimeSeriesChart
              series={pickSeries(series, ['underReplicated', 'offlinePartitions'])}
              unit="count"
              loading={metrics.isLoading}
              error={metrics.error}
              labels={{ underReplicated: 'Under-replicated', offlinePartitions: 'Offline' }}
              colorOffset={2}
              area={false}
              height={220}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardToolbarHeader
            title="Health checks"
            actions={health.data ? <StatusPill status={health.data.status} /> : null}
          />
          <CardContent>
            <HealthChecks
              checks={health.data?.checks}
              loading={health.isLoading}
              error={health.error}
              onRetry={() => void health.refetch()}
              dataUpdatedAt={health.dataUpdatedAt}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardToolbarHeader
            title="KRaft quorum"
            description="Metadata log replication state"
            actions={
              quorum.data?.leaderId !== undefined && quorum.data?.leaderId !== null ? (
                <Badge variant="info">leader {quorum.data.leaderId}</Badge>
              ) : null
            }
          />
          <CardContent>
            {quorum.error ? (
              <EmptyState
                compact
                icon={Crown}
                title="Quorum unavailable"
                description="This cluster does not expose KRaft quorum information (ZooKeeper mode or unsupported broker version)."
              />
            ) : quorum.data && quorum.data.voters.length > 0 ? (
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Node</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead numeric>Log end offset</TableHead>
                      <TableHead numeric>Lag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ...quorum.data.voters.map((v) => ({ ...v, role: 'voter' })),
                      ...(quorum.data.observers ?? []).map((v) => ({ ...v, role: 'observer' })),
                    ].map((replica) => (
                      <TableRow
                        key={`${replica.role}-${replica.id}`}
                        className="hover:bg-transparent"
                      >
                        <TableCell>
                          <span className="font-mono tabular-nums">{replica.id}</span>
                          {replica.id === quorum.data?.leaderId ? (
                            <Badge variant="default" size="sm" className="ml-2">
                              leader
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={replica.role === 'voter' ? 'info' : 'secondary'}
                            size="sm"
                          >
                            {replica.role}
                          </Badge>
                        </TableCell>
                        <TableCell numeric>{formatNumber(replica.logEndOffset)}</TableCell>
                        <TableCell
                          numeric
                          className={replica.lag > 0 ? 'text-[var(--warning)]' : undefined}
                        >
                          {formatNumber(replica.lag)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState compact icon={Crown} title="No quorum data" />
            )}

            {data?.listeners?.length ? (
              <div className="mt-4 space-y-1.5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Listeners
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {data.listeners.map((l) => (
                    <CodeInline key={l}>{l}</CodeInline>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardToolbarHeader
            title="Partition health"
            description="Offline, under-replicated and non-preferred-leader partitions"
            actions={
              unhealthy.data ? (
                <div className="flex items-center gap-2">
                  {unhealthy.data.offline > 0 ? (
                    <Badge variant="danger">{unhealthy.data.offline} offline</Badge>
                  ) : null}
                  {unhealthy.data.underReplicated > 0 ? (
                    <Badge variant="warning">{unhealthy.data.underReplicated} URP</Badge>
                  ) : null}
                  {unhealthy.data.nonPreferredLeader > 0 ? (
                    <Badge variant="info">{unhealthy.data.nonPreferredLeader} non-preferred</Badge>
                  ) : null}
                  {unhealthyItems.length > 0 ? (
                    <Button variant="ghost" size="sm" onClick={openHealth}>
                      View all <ArrowUpRight />
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
          <CardContent>
            {unhealthy.error ? (
              <InlineError error={unhealthy.error} onRetry={() => void unhealthy.refetch()} />
            ) : unhealthy.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : unhealthyItems.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="All partitions healthy"
                description={`${formatNumber(unhealthy.data?.scannedPartitions)} partitions scanned — every one has a live leader and a full ISR.`}
              />
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Topic</TableHead>
                      <TableHead numeric>Partition</TableHead>
                      <TableHead numeric>Leader</TableHead>
                      <TableHead>ISR</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unhealthyItems.slice(0, PANEL_ROWS).map((p) => (
                      <TableRow key={`${p.topic}-${p.partition}`} clickable onClick={openHealth}>
                        <TableCell className="font-mono text-[13px]">{p.topic}</TableCell>
                        <TableCell numeric>{p.partition}</TableCell>
                        <TableCell numeric>
                          {p.leader === null ? (
                            <span className="text-[var(--danger)]">none</span>
                          ) : (
                            p.leader
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {p.isr.length}/{p.replicas.length}
                        </TableCell>
                        <TableCell>
                          <ReasonBadges reasons={p.reasons} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {unhealthyItems.length > PANEL_ROWS ? (
                  <button
                    type="button"
                    onClick={openHealth}
                    className="w-full border-t border-[var(--border)] px-3 py-2 text-left text-xs text-[var(--primary)] hover:bg-[var(--surface-2)]"
                  >
                    +{unhealthyItems.length - PANEL_ROWS} more — view all
                  </button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader
            title="Top lagging consumer groups"
            description={`Highest total lag (top ${TOP_GROUPS})`}
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to={`/c/${cluster}/consumers`}>
                  <Users /> All groups <ArrowUpRight />
                </Link>
              </Button>
            }
          />
          <CardContent>
            {groups.error ? (
              <InlineError error={groups.error} onRetry={() => void groups.refetch()} />
            ) : groups.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : topGroups.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="No consumer lag"
                description={
                  (groups.data?.length ?? 0) === 0
                    ? 'No consumer groups on this cluster yet.'
                    : 'Every consumer group is caught up.'
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Group</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead numeric>Members</TableHead>
                      <TableHead numeric>Lag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topGroups.map((g) => (
                      <TableRow key={g.groupId} className="hover:bg-transparent">
                        <TableCell>
                          <Link
                            to={`/c/${cluster}/consumers/${encodeURIComponent(g.groupId)}`}
                            className="block max-w-[260px] truncate font-mono text-[13px] hover:text-[var(--primary)]"
                          >
                            {g.groupId}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={g.state} />
                        </TableCell>
                        <TableCell numeric>{formatNumber(g.memberCount)}</TableCell>
                        <TableCell numeric className="text-[var(--warning)]">
                          {formatCompact(g.totalLag)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Partition health</DialogTitle>
            <DialogDescription>
              {unhealthy.data
                ? `${unhealthyItems.length} of ${formatNumber(unhealthy.data.scannedPartitions)} partitions need attention — ${unhealthy.data.offline} offline, ${unhealthy.data.underReplicated} under-replicated, ${unhealthy.data.nonPreferredLeader} with a non-preferred leader.`
                : 'Cluster-wide partitions that are offline, under-replicated or led by a non-preferred replica.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <DataTable
              columns={partitionColumns}
              data={unhealthyItems}
              loading={unhealthy.isLoading}
              error={unhealthy.error}
              onRetry={() => void unhealthy.refetch()}
              globalFilter={healthSearch}
              onGlobalFilterChange={setHealthSearch}
              searchPlaceholder="Filter by topic or reason…"
              getRowId={(row) => `${row.topic}-${row.partition}`}
              maxHeight={420}
              rowLabel="partitions"
              emptyState={
                <EmptyState
                  compact
                  icon={CheckCircle2}
                  title={healthSearch ? 'No partitions match' : 'All partitions healthy'}
                />
              }
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ClusterOverviewPage;
