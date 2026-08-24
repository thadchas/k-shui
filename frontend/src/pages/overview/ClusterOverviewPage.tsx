import { useState } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  ArrowUpRight,
  Boxes,
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
} from '@/api/hooks/clusters';
import type { TimeRange } from '@/api/types';
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
import { TimeRangePicker } from '@/components/ui/time-range-picker';

const QUICK_LINKS = [
  { label: 'Brokers', to: 'brokers', icon: Server },
  { label: 'Topics', to: 'topics', icon: Layers },
  { label: 'Consumers', to: 'consumers', icon: Users },
  { label: 'Security', to: 'security', icon: ShieldAlert },
];

export function ClusterOverviewPage() {
  const cluster = useClusterId();
  const [range, setRange] = useState<TimeRange>('1h');

  const detail = useCluster(cluster);
  const health = useClusterHealth(cluster);
  const metrics = useOverviewMetrics(cluster, { range });
  const quorum = useKRaftQuorum(cluster);

  const data = detail.data;
  const series = metrics.data?.series;

  if (detail.error) {
    return (
      <div>
        <PageHeader title="Overview" />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const brokersDown = (data?.brokerCount ?? 0) - (data?.onlineBrokers ?? 0);

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
        />
        <StatTile
          label="Offline partitions"
          loading={detail.isLoading}
          value={formatNumber(data?.offlinePartitions)}
          tone={(data?.offlinePartitions ?? 0) > 0 ? 'danger' : 'success'}
          icon={ShieldAlert}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_LINKS.map((link) => (
          <Button
            key={link.to}
            asChild
            variant="outline"
            className="h-auto justify-between p-4 text-left"
          >
            <Link to={`/c/${cluster}/${link.to}`}>
              <span className="flex items-center gap-2 text-sm font-medium">
                <link.icon className="size-4 text-[var(--primary)]" />
                {link.label}
              </span>
              <ArrowUpRight className="size-3.5 text-[var(--muted)]" />
            </Link>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default ClusterOverviewPage;
