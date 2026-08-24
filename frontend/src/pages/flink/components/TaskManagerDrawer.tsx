import { useState } from 'react';
import { Download, Server } from 'lucide-react';
import {
  flinkLogUrl,
  useFlinkTaskManager,
  useFlinkTaskManagerLogFile,
  useFlinkTaskManagerLogList,
  useFlinkTaskManagerMetrics,
  useFlinkThreadDump,
} from '@/api/hooks/flink';
import type { FlinkTaskManagerDetail } from '@/api/types';
import { formatBytes, formatDecimal, formatNumber, formatRelative } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { metricValue } from '../flinkLib';
import { UsageBar } from './TaskStatusBar';

const TM_METRICS = [
  'Status.JVM.Memory.Heap.Used',
  'Status.JVM.Memory.Heap.Max',
  'Status.JVM.Memory.NonHeap.Used',
  'Status.JVM.Memory.Direct.MemoryUsed',
  'Status.JVM.Memory.Direct.TotalCapacity',
  'Status.Flink.Memory.Managed.Used',
  'Status.Flink.Memory.Managed.Total',
  'Status.JVM.CPU.Load',
  'Status.JVM.Threads.Count',
  'Status.JVM.GarbageCollector.All.Count',
  'Status.JVM.GarbageCollector.All.Time',
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2 last:border-0">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-xs tabular-nums text-[var(--foreground)]">
        {value}
      </span>
    </div>
  );
}

export interface TaskManagerDrawerProps {
  cluster: string;
  flinkCluster: string;
  taskManager: FlinkTaskManagerDetail | null;
  onOpenChange: (open: boolean) => void;
}

export function TaskManagerDrawer({
  cluster,
  flinkCluster,
  taskManager,
  onOpenChange,
}: TaskManagerDrawerProps) {
  const id = taskManager?.id;
  const [tab, setTab] = useState('metrics');
  const [logFile, setLogFile] = useState<string | undefined>();

  const detail = useFlinkTaskManager(cluster, flinkCluster, id);
  const metrics = useFlinkTaskManagerMetrics(cluster, flinkCluster, id, TM_METRICS);
  const logList = useFlinkTaskManagerLogList(cluster, flinkCluster, id, tab === 'logs');
  const activeFile = logFile ?? logList.data?.logs?.[0]?.name;
  const logContent = useFlinkTaskManagerLogFile(cluster, flinkCluster, id, activeFile);
  const threads = useFlinkThreadDump(cluster, flinkCluster, id, tab === 'threads');

  const tm = detail.data ?? taskManager;
  const mem = tm?.memoryConfiguration;
  const heapUsed = metricValue(metrics.data, 'Status.JVM.Memory.Heap.Used');
  const heapMax = metricValue(metrics.data, 'Status.JVM.Memory.Heap.Max');
  const managedUsed = metricValue(metrics.data, 'Status.Flink.Memory.Managed.Used');
  const managedTotal =
    metricValue(metrics.data, 'Status.Flink.Memory.Managed.Total') ?? mem?.managedMemory ?? 0;
  const directUsed = metricValue(metrics.data, 'Status.JVM.Memory.Direct.MemoryUsed');
  const directTotal = metricValue(metrics.data, 'Status.JVM.Memory.Direct.TotalCapacity');

  return (
    <Sheet open={Boolean(taskManager)} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Server className="size-4 text-[var(--primary)]" />
            <span className="truncate font-mono text-sm">{tm?.id}</span>
            {tm ? <CopyButton value={tm.id} tooltip="Copy id" /> : null}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {(tm?.slotsNumber ?? 0) - (tm?.freeSlots ?? 0)}/{tm?.slotsNumber ?? 0} slots used
            </Badge>
            {tm?.hardware?.cpuCores ? (
              <Badge variant="outline">{tm.hardware.cpuCores} cores</Badge>
            ) : null}
          </div>
        </SheetHeader>

        <SheetBody className="flex min-h-0 flex-1 flex-col">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="threads">Thread dump</TabsTrigger>
            </TabsList>

            <TabsContent value="metrics" className="space-y-5">
              {metrics.error ? (
                <InlineError error={metrics.error} onRetry={() => void metrics.refetch()} />
              ) : null}
              <div className="space-y-4">
                <UsageBar
                  label="JVM heap"
                  used={heapUsed ?? 0}
                  total={heapMax ?? mem?.taskHeap ?? 0}
                  format={(v) => formatBytes(v)}
                />
                <UsageBar
                  label="Managed memory"
                  used={managedUsed ?? 0}
                  total={managedTotal}
                  format={(v) => formatBytes(v)}
                />
                <UsageBar
                  label="Direct memory"
                  used={directUsed ?? 0}
                  total={directTotal ?? mem?.networkMemory ?? 0}
                  format={(v) => formatBytes(v)}
                />
                <UsageBar
                  label="Slots"
                  used={(tm?.slotsNumber ?? 0) - (tm?.freeSlots ?? 0)}
                  total={tm?.slotsNumber ?? 0}
                />
              </div>
              <div>
                <Row
                  label="CPU load"
                  value={
                    metricValue(metrics.data, 'Status.JVM.CPU.Load') === null
                      ? '—'
                      : `${formatDecimal(
                          (metricValue(metrics.data, 'Status.JVM.CPU.Load') ?? 0) * 100,
                        )}%`
                  }
                />
                <Row
                  label="Threads"
                  value={formatNumber(metricValue(metrics.data, 'Status.JVM.Threads.Count'))}
                />
                <Row
                  label="GC collections"
                  value={formatNumber(
                    metricValue(metrics.data, 'Status.JVM.GarbageCollector.All.Count'),
                  )}
                />
                <Row
                  label="GC time"
                  value={`${formatNumber(
                    metricValue(metrics.data, 'Status.JVM.GarbageCollector.All.Time'),
                  )} ms`}
                />
                <Row
                  label="Non-heap used"
                  value={formatBytes(metricValue(metrics.data, 'Status.JVM.Memory.NonHeap.Used'))}
                />
              </div>
            </TabsContent>

            <TabsContent value="details">
              {detail.error ? (
                <InlineError error={detail.error} onRetry={() => void detail.refetch()} />
              ) : null}
              <div>
                <Row label="Path" value={tm?.path ?? '—'} />
                <Row label="Data port" value={tm?.dataPort ?? '—'} />
                <Row label="JMX port" value={tm && tm.jmxPort && tm.jmxPort > 0 ? tm.jmxPort : '—'} />
                <Row
                  label="Last heartbeat"
                  value={tm?.timeSinceLastHeartbeat ? formatRelative(tm.timeSinceLastHeartbeat) : '—'}
                />
                <Row label="Physical memory" value={formatBytes(tm?.hardware?.physicalMemory)} />
                <Row label="Free memory" value={formatBytes(tm?.hardware?.freeMemory)} />
                <Row label="Framework heap" value={formatBytes(mem?.frameworkHeap)} />
                <Row label="Task heap" value={formatBytes(mem?.taskHeap)} />
                <Row label="Network memory" value={formatBytes(mem?.networkMemory)} />
                <Row label="JVM metaspace" value={formatBytes(mem?.jvmMetaspace)} />
                <Row label="Total process memory" value={formatBytes(mem?.totalProcessMemory)} />
              </div>
            </TabsContent>

            <TabsContent value="logs" className="min-h-0 flex-1 space-y-3">
              {logList.error ? (
                <InlineError error={logList.error} onRetry={() => void logList.refetch()} />
              ) : logList.isLoading ? (
                <Skeleton className="h-8 w-64" />
              ) : (logList.data?.logs?.length ?? 0) === 0 ? (
                <EmptyState compact title="No log files" description="This task manager exposes no logs." />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <SimpleSelect
                    size="sm"
                    className="w-full max-w-md"
                    value={activeFile}
                    onValueChange={setLogFile}
                    aria-label="Log file"
                    options={(logList.data?.logs ?? []).map((l) => ({
                      label: `${l.name} (${formatBytes(l.size)})`,
                      value: l.name,
                    }))}
                  />
                  {id && activeFile ? (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={flinkLogUrl(cluster, flinkCluster, 'taskmanagers', id, activeFile)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download /> Open raw
                      </a>
                    </Button>
                  ) : null}
                </div>
              )}
              {logContent.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : logContent.error ? (
                <InlineError error={logContent.error} onRetry={() => void logContent.refetch()} />
              ) : logContent.data ? (
                <CodeBlock
                  code={logContent.data.slice(-200_000)}
                  title={activeFile}
                  maxHeight={420}
                  wrap
                />
              ) : null}
            </TabsContent>

            <TabsContent value="threads" className="min-h-0 flex-1">
              {threads.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : threads.error ? (
                <InlineError error={threads.error} onRetry={() => void threads.refetch()} />
              ) : (threads.data?.threadInfos?.length ?? 0) === 0 ? (
                <EmptyState compact title="No thread dump" />
              ) : (
                <CodeBlock
                  code={(threads.data?.threadInfos ?? [])
                    .map((t) => t.stringifiedThreadInfo)
                    .join('\n')}
                  title={`${threads.data?.threadInfos.length} threads`}
                  maxHeight={480}
                />
              )}
            </TabsContent>
          </Tabs>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
