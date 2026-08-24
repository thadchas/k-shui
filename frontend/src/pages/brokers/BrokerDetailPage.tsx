import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Crown, HardDrive } from 'lucide-react';
import {
  useBroker,
  useBrokerConfigs,
  useBrokerLogDirs,
  useBrokerMetrics,
  useUpdateBrokerConfigs,
} from '@/api/hooks/brokers';
import type { TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { pickSeries } from '@/lib/charts';
import { formatBytes, formatNumber } from '@/lib/format';
import { ConfigTable } from '@/components/ConfigTable';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';

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
              label="Log dir size"
              loading={broker.isLoading}
              value={formatBytes(data?.logDirSizeBytes)}
              icon={HardDrive}
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
            logdirs.data.map((dir) => (
              <Card key={dir.path}>
                <CardToolbarHeader
                  title={<span className="font-mono text-sm">{dir.path}</span>}
                  description={`${formatNumber(dir.partitions.length)} partitions`}
                  actions={<Badge variant="info">{formatBytes(dir.sizeBytes)}</Badge>}
                />
                <CardContent>
                  <div className="max-h-96 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)]">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Topic</TableHead>
                          <TableHead numeric>Partition</TableHead>
                          <TableHead numeric>Size</TableHead>
                          <TableHead numeric>Offset lag</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dir.partitions.map((p) => (
                          <TableRow key={`${p.topic}-${p.partition}`}>
                            <TableCell className="font-mono text-[13px]">{p.topic}</TableCell>
                            <TableCell numeric>{p.partition}</TableCell>
                            <TableCell numeric>{formatBytes(p.sizeBytes)}</TableCell>
                            <TableCell numeric>{formatNumber(p.offsetLag)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))
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
