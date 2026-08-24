import { useMemo, useState } from 'react';
import { Download, Search, Settings2 } from 'lucide-react';
import {
  flinkLogUrl,
  useFlinkJobManagerConfig,
  useFlinkJobManagerLogFile,
  useFlinkJobManagerLogList,
  useFlinkJobManagerMetricValues,
} from '@/api/hooks/flink';
import { formatBytes, formatDecimal, formatNumber } from '@/lib/format';
import { isSensitiveConfigName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile, StatTileRow } from '@/components/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { metricValue } from '../flinkLib';
import { UsageBar } from './TaskStatusBar';

const JM_METRICS = [
  'Status.JVM.Memory.Heap.Used',
  'Status.JVM.Memory.Heap.Max',
  'Status.JVM.Memory.NonHeap.Used',
  'Status.JVM.Threads.Count',
  'Status.JVM.CPU.Load',
  'Status.JVM.GarbageCollector.All.Count',
  'Status.JVM.GarbageCollector.All.Time',
  'taskSlotsTotal',
  'taskSlotsAvailable',
  'numRegisteredTaskManagers',
  'numRunningJobs',
];

const MASK = '••••••••';

export function JobManagerTab({
  cluster,
  flinkCluster,
}: {
  cluster: string;
  flinkCluster: string;
}) {
  const config = useFlinkJobManagerConfig(cluster, flinkCluster);
  const metrics = useFlinkJobManagerMetricValues(cluster, flinkCluster, JM_METRICS);
  const logList = useFlinkJobManagerLogList(cluster, flinkCluster);
  const [logFile, setLogFile] = useState<string | undefined>();
  const activeFile = logFile ?? logList.data?.logs?.[0]?.name;
  const logContent = useFlinkJobManagerLogFile(cluster, flinkCluster, activeFile);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const all = config.data ?? [];
    const q = filter.trim().toLowerCase();
    const list = q
      ? all.filter(
          (c) => c.key.toLowerCase().includes(q) || (c.value ?? '').toLowerCase().includes(q),
        )
      : all;
    return [...list].sort((a, b) => a.key.localeCompare(b.key));
  }, [config.data, filter]);

  const heapUsed = metricValue(metrics.data, 'Status.JVM.Memory.Heap.Used');
  const heapMax = metricValue(metrics.data, 'Status.JVM.Memory.Heap.Max');
  const slotsTotal = metricValue(metrics.data, 'taskSlotsTotal');
  const slotsFree = metricValue(metrics.data, 'taskSlotsAvailable');

  return (
    <div className="space-y-4">
      <StatTileRow columns={4}>
        <StatTile
          label="Running jobs"
          value={formatNumber(metricValue(metrics.data, 'numRunningJobs'))}
          loading={metrics.isLoading}
        />
        <StatTile
          label="Task managers"
          value={formatNumber(metricValue(metrics.data, 'numRegisteredTaskManagers'))}
          loading={metrics.isLoading}
        />
        <StatTile
          label="JVM threads"
          value={formatNumber(metricValue(metrics.data, 'Status.JVM.Threads.Count'))}
          loading={metrics.isLoading}
        />
        <StatTile
          label="CPU load"
          value={
            metricValue(metrics.data, 'Status.JVM.CPU.Load') === null
              ? '—'
              : `${formatDecimal((metricValue(metrics.data, 'Status.JVM.CPU.Load') ?? 0) * 100)}%`
          }
          loading={metrics.isLoading}
        />
      </StatTileRow>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardToolbarHeader title="Resources" description="JobManager JVM and slot usage" />
          <CardContent className="space-y-4">
            {metrics.error ? (
              <InlineError error={metrics.error} onRetry={() => void metrics.refetch()} />
            ) : null}
            <UsageBar
              label="JVM heap"
              used={heapUsed ?? 0}
              total={heapMax ?? 0}
              format={(v) => formatBytes(v)}
            />
            <UsageBar
              label="Task slots"
              used={(slotsTotal ?? 0) - (slotsFree ?? 0)}
              total={slotsTotal ?? 0}
            />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-[var(--radius-control)] bg-[var(--surface-2)] p-3">
                <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">GC count</p>
                <p className="font-mono text-base tabular-nums">
                  {formatNumber(metricValue(metrics.data, 'Status.JVM.GarbageCollector.All.Count'))}
                </p>
              </div>
              <div className="rounded-[var(--radius-control)] bg-[var(--surface-2)] p-3">
                <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">GC time</p>
                <p className="font-mono text-base tabular-nums">
                  {formatNumber(metricValue(metrics.data, 'Status.JVM.GarbageCollector.All.Time'))}{' '}
                  ms
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardToolbarHeader
            title="Logs"
            description="JobManager log files"
            actions={
              activeFile ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={flinkLogUrl(cluster, flinkCluster, 'jobmanager', null, activeFile)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download /> Raw
                  </a>
                </Button>
              ) : null
            }
          />
          <CardContent className="space-y-3">
            {logList.error ? (
              <InlineError error={logList.error} onRetry={() => void logList.refetch()} />
            ) : logList.isLoading ? (
              <Skeleton className="h-8 w-64" />
            ) : (logList.data?.logs?.length ?? 0) === 0 ? (
              <EmptyState compact title="No log files" />
            ) : (
              <SimpleSelect
                size="sm"
                className="w-full"
                value={activeFile}
                onValueChange={setLogFile}
                aria-label="Log file"
                options={(logList.data?.logs ?? []).map((l) => ({
                  label: `${l.name} (${formatBytes(l.size)})`,
                  value: l.name,
                }))}
              />
            )}
            {logContent.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : logContent.error ? (
              <InlineError error={logContent.error} onRetry={() => void logContent.refetch()} />
            ) : logContent.data ? (
              <CodeBlock code={logContent.data.slice(-120_000)} maxHeight={300} wrap />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardToolbarHeader
          title="Configuration"
          description={`${rows.length} effective JobManager settings`}
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter configs…"
                className="h-8 w-56 pl-8"
                aria-label="Filter configuration"
              />
            </div>
          }
        />
        <CardContent>
          {config.error ? (
            <InlineError error={config.error} onRetry={() => void config.refetch()} />
          ) : config.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon={Settings2}
              title={filter ? 'No configs match' : 'No configuration'}
            />
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Key</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.key} className="hover:bg-[var(--surface-2)]">
                      <TableCell className="font-mono text-2xs">{c.key}</TableCell>
                      <TableCell className="break-all font-mono text-2xs text-[var(--muted)]">
                        {isSensitiveConfigName(c.key) ? MASK : c.value}
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
  );
}
