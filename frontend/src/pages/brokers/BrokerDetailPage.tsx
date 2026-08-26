import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeft, Crown, HardDrive } from 'lucide-react';
import {
  useBroker,
  useBrokerConfigs,
  useBrokerLogDirs,
  useBrokerMetrics,
  useUpdateBrokerConfigs,
} from '@/api/hooks/brokers';
import type { LogDir, LogDirPartition, TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { usePermissions } from '@/hooks/usePermissions';
import { pickSeries } from '@/lib/charts';
import { formatBytes, formatNumber } from '@/lib/format';
import { ConfigTable } from '@/components/ConfigTable';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import { DiskUsageBar, diskPercent, diskTone } from './DiskUsageBar';

/** One log directory: capacity header (or offline flag) + sortable, searchable partition table. */
function LogDirCard({ dir, cluster }: { dir: LogDir; cluster: string }) {
  const [search, setSearch] = useState('');
  const pct = diskPercent(dir.totalBytes, dir.usableBytes);
  const tone = diskTone(pct);
  const offline = Boolean(dir.error);

  const columns = useMemo<ColumnDef<LogDirPartition>[]>(
    () => [
      {
        accessorKey: 'topic',
        header: 'Topic',
        meta: { label: 'Topic' },
        cell: ({ row }) => (
          <Link
            to={`/c/${cluster}/topics/${encodeURIComponent(row.original.topic)}`}
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
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size' },
        sortUndefined: 'last',
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        accessorKey: 'offsetLag',
        header: 'Offset lag',
        meta: { numeric: true, label: 'Offset lag' },
        sortUndefined: 'last',
        cell: ({ row }) => (
          <span className={(row.original.offsetLag ?? 0) > 0 ? 'text-[var(--warning)]' : undefined}>
            {formatNumber(row.original.offsetLag)}
          </span>
        ),
      },
    ],
    [cluster],
  );

  return (
    <Card
      className={
        offline ? 'border-[color-mix(in_srgb,var(--danger)_50%,var(--border))]' : undefined
      }
    >
      <CardToolbarHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm">{dir.path}</span>
            {offline ? (
              <Badge variant="danger">
                <AlertTriangle className="size-3" /> offline
              </Badge>
            ) : null}
          </span>
        }
        description={
          offline
            ? `Broker reported ${dir.error} for this directory — its replicas are unavailable.`
            : `${formatNumber(dir.partitions.length)} partitions · ${formatBytes(dir.sizeBytes)} of logs${
                pct !== null ? ` · ${formatBytes(dir.usableBytes)} free` : ''
              }`
        }
        actions={
          pct !== null ? (
            <DiskUsageBar
              totalBytes={dir.totalBytes}
              usableBytes={dir.usableBytes}
              fallbackBytes={dir.sizeBytes}
            />
          ) : (
            <Badge variant={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'info'}>
              {formatBytes(dir.sizeBytes)}
            </Badge>
          )
        }
      />
      <CardContent>
        <DataTable
          columns={columns}
          data={dir.partitions}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          searchPlaceholder="Search topics…"
          defaultSorting={[{ id: 'sizeBytes', desc: true }]}
          getRowId={(row) => `${row.topic}-${row.partition}`}
          maxHeight={384}
          rowLabel="partitions"
          caption={`Partitions stored in log directory ${dir.path}`}
          emptyState={
            <EmptyState
              compact
              icon={HardDrive}
              title={search ? 'No partitions match' : 'No partitions in this directory'}
            />
          }
        />
      </CardContent>
    </Card>
  );
}

export function BrokerDetailPage() {
  const cluster = useClusterId();
  const { brokerId = '' } = useParams<{ brokerId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const [range, setRange] = useState<TimeRange>('1h');

  const broker = useBroker(cluster, brokerId);
  const configs = useBrokerConfigs(cluster, brokerId);
  const logdirs = useBrokerLogDirs(cluster, brokerId);
  const metrics = useBrokerMetrics(cluster, brokerId, { range });
  const updateConfigs = useUpdateBrokerConfigs(cluster, brokerId);
  const { canEdit } = usePermissions();

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  if (broker.error) {
    return (
      <div>
        <PageHeader title={`Broker ${brokerId}`} />
        <ErrorState error={broker.error} onRetry={() => void broker.refetch()} />
      </div>
    );
  }

  const data = broker.data;
  const series = metrics.data?.series;
  const diskPct = diskPercent(data?.logDirTotalBytes, data?.logDirUsableBytes);
  const offlineDirs = (logdirs.data ?? []).filter((d) => d.error).length;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Broker {brokerId}
            {data?.isController ? (
              <Badge variant="warning">
                <Crown className="size-3" /> controller
              </Badge>
            ) : null}
          </span>
        }
        description={
          data ? `${data.host}:${data.port}${data.rack ? ` · rack ${data.rack}` : ''}` : undefined
        }
        meta={data ? <StatusPill status={data.status} /> : null}
        actions={
          <Button
            variant="outline"
            size="md"
            onClick={() => void navigate(`/c/${cluster}/brokers`)}
          >
            <ArrowLeft /> All brokers
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configs">Configs</TabsTrigger>
          <TabsTrigger value="logdirs">Log dirs</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <StatTileRow columns={4}>
            <StatTile
              label="Partitions"
              loading={broker.isLoading}
              value={formatNumber(data?.partitionCount)}
            />
            <StatTile
              label="Leaders"
              loading={broker.isLoading}
              value={formatNumber(data?.leaderCount)}
            />
            <StatTile
              label="Under-replicated"
              loading={broker.isLoading}
              value={formatNumber(data?.underReplicatedPartitions)}
              tone={(data?.underReplicatedPartitions ?? 0) > 0 ? 'warning' : 'success'}
            />
            <StatTile
              label={diskPct !== null ? 'Disk used' : 'Log dir size'}
              loading={broker.isLoading}
              value={
                diskPct !== null ? `${diskPct.toFixed(0)}%` : formatBytes(data?.logDirSizeBytes)
              }
              tone={offlineDirs > 0 ? 'danger' : diskTone(diskPct)}
              hint={
                offlineDirs > 0
                  ? `${offlineDirs} log dir${offlineDirs === 1 ? '' : 's'} offline`
                  : diskPct !== null
                    ? `${formatBytes(data?.logDirSizeBytes)} logs · ${formatBytes(data?.logDirUsableBytes)} free of ${formatBytes(data?.logDirTotalBytes)}`
                    : 'Capacity not reported by this broker'
              }
              icon={HardDrive}
              onClick={() => setTab('logdirs')}
            />
          </StatTileRow>

          <Card>
            <CardToolbarHeader
              title="Throughput"
              actions={<TimeRangePicker size="sm" value={range} onValueChange={setRange} />}
            />
            <CardContent>
              <TimeSeriesChart
                series={pickSeries(series, ['bytesIn', 'bytesOut'])}
                unit="bytes/s"
                loading={metrics.isLoading}
                error={metrics.error}
                labels={{ bytesIn: 'Bytes in', bytesOut: 'Bytes out' }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configs">
          <ConfigTable
            configs={configs.data}
            loading={configs.isLoading}
            error={configs.error}
            onRetry={() => void configs.refetch()}
            saving={updateConfigs.isPending}
            readOnly={!canEdit}
            onSave={async (changes) => {
              try {
                await updateConfigs.mutateAsync({ configs: changes });
                toast.success('Broker configs updated');
              } catch (e) {
                toastError('Failed to update configs', e);
                throw e;
              }
            }}
          />
        </TabsContent>

        <TabsContent value="logdirs" className="space-y-4">
          {logdirs.error ? (
            <ErrorState error={logdirs.error} onRetry={() => void logdirs.refetch()} />
          ) : logdirs.isLoading ? (
            <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
          ) : !logdirs.data || logdirs.data.length === 0 ? (
            <Card>
              <EmptyState icon={HardDrive} title="No log directories reported" />
            </Card>
          ) : (
            // Offline directories first so a failed disk is never hidden below healthy ones.
            [...logdirs.data]
              .sort((a, b) => Number(Boolean(b.error)) - Number(Boolean(a.error)))
              .map((dir) => <LogDirCard key={dir.path} dir={dir} cluster={cluster} />)
          )}
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <div className="flex justify-end">
            <TimeRangePicker value={range} onValueChange={setRange} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardToolbarHeader title="Throughput" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['bytesIn', 'bytesOut'])}
                  unit="bytes/s"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  labels={{ bytesIn: 'Bytes in', bytesOut: 'Bytes out' }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardToolbarHeader title="Request latency (p99)" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['produceLatencyP99', 'fetchLatencyP99'])}
                  unit="ms"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  area={false}
                  colorOffset={2}
                  labels={{ produceLatencyP99: 'Produce p99', fetchLatencyP99: 'Fetch p99' }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardToolbarHeader title="Handler idle" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['requestHandlerIdle', 'networkProcessorIdle'])}
                  unit="percent"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  colorOffset={4}
                  labels={{
                    requestHandlerIdle: 'Request handler',
                    networkProcessorIdle: 'Network processor',
                  }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardToolbarHeader title="JVM" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['jvmHeapUsed', 'gcTime'])}
                  unit="bytes"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  colorOffset={6}
                  labels={{ jvmHeapUsed: 'Heap used', gcTime: 'GC time' }}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default BrokerDetailPage;
