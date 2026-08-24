import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';
import {
  isSavepointDone,
  useFlinkJobAction,
  useFlinkJobDetail,
  useFlinkSavepoint,
  useFlinkSavepointStatus,
  useFlinkVertexBackpressures,
} from '@/api/hooks/flink';
import type { FlinkBackpressure, FlinkVertexDetail } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import {
  formatBytes,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatTimestamp,
} from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { CheckpointsTab } from './components/CheckpointsTab';
import { ExceptionsTab } from './components/ExceptionsTab';
import { JobGraphTab } from './components/JobGraphTab';
import { JobMetricsTab } from './components/JobMetricsTab';
import { SavepointDialog, type SavepointMode } from './components/SavepointDialog';
import { TaskStatusBar, TaskStatusLegend } from './components/TaskStatusBar';
import { flinkStateTone, liveDuration, ratioPct, shortVertexName, useNow } from './flinkLib';

const TABS = ['overview', 'graph', 'checkpoints', 'exceptions', 'metrics'] as const;
const TERMINAL = /^(FINISHED|FAILED|CANCELED|CANCELLED|SUSPENDED)$/i;

const LIFETIME_HELP =
  'Lifetime: accumulated backpressured time divided by the vertex duration — an average over the whole run.';
const CURRENT_HELP =
  'Current: the highest backpressured ratio across subtasks from the JobManager\u2019s latest backpressure sample (refreshed every ~10s).';

/** Highest sampled backpressure ratio (0–100) across a vertex's subtasks. */
function currentBackpressurePct(sample: FlinkBackpressure | undefined): number | null {
  if (!sample || sample.status?.toLowerCase() === 'deprecated') return null;
  const ratios = (sample.subtasks ?? [])
    .map((s) => s.ratio)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  if (ratios.length === 0) return null;
  return Math.min(100, Math.max(0, Math.max(...ratios) * 100));
}

interface SavepointTrack {
  triggerId: string;
  mode: SavepointMode;
  startedAt: number;
}

function PercentCell({ value, danger }: { value: number | null; danger?: boolean }) {
  if (value === null) return <span className="text-[var(--muted)]">—</span>;
  const color =
    danger && value > 10
      ? 'var(--danger)'
      : !danger && value > 80
        ? 'var(--warning)'
        : 'var(--muted)';
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${value}%`, background: color }}
        />
      </span>
      <span className="font-mono tabular-nums" style={{ color }}>
        {formatDecimal(value)}%
      </span>
    </div>
  );
}

export function FlinkJobPage() {
  const cluster = useClusterId();
  const { fc = '', jid = '' } = useParams<{ fc: string; jid: string }>();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') ?? 'overview';
  const tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : 'overview';
  const now = useNow(1000);

  const job = useFlinkJobDetail(cluster, fc, jid);
  const jobAction = useFlinkJobAction(cluster, fc);
  const savepointMutation = useFlinkSavepoint(cluster, fc);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [savepointMode, setSavepointMode] = useState<SavepointMode | null>(null);
  /** Last savepoint/stop trigger from this page; polled until COMPLETED or FAILED. */
  const [lastSavepoint, setLastSavepoint] = useState<SavepointTrack | null>(null);
  const savepointStatus = useFlinkSavepointStatus(cluster, fc, jid, lastSavepoint?.triggerId);

  const data = job.data;
  const base = `/c/${cluster}/flink/${encodeURIComponent(fc)}`;
  const running = data ? !TERMINAL.test(data.state) : false;

  const vertexIds = useMemo(() => (data?.vertices ?? []).map((v) => v.id), [data?.vertices]);
  const backpressure = useFlinkVertexBackpressures(cluster, fc, jid, vertexIds, running);
  const bpByVertex = backpressure.byVertex;

  const columns = useMemo<ColumnDef<FlinkVertexDetail>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Vertex',
        meta: { label: 'Vertex' },
        cell: ({ row }) => (
          <span className="block truncate text-[13px] font-medium" title={row.original.name}>
            {shortVertexName(row.original.name, 64)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { label: 'Status', widthClass: 'w-32' },
        cell: ({ row }) => (
          <StatusPill
            status={row.original.status}
            tone={flinkStateTone(row.original.status)}
            label={row.original.status.toLowerCase()}
          />
        ),
      },
      {
        accessorKey: 'parallelism',
        header: 'Parallelism',
        meta: { numeric: true, label: 'Parallelism', widthClass: 'w-28' },
      },
      {
        id: 'tasks',
        header: 'Tasks',
        meta: { label: 'Tasks', widthClass: 'w-36' },
        cell: ({ row }) => <TaskStatusBar tasks={row.original.tasks} showCounts={false} />,
      },
      {
        id: 'recordsIn',
        header: 'Records in',
        meta: { numeric: true, label: 'Records in', widthClass: 'w-28' },
        accessorFn: (row) => row.metrics?.readRecords ?? 0,
        cell: ({ row }) => formatCompact(row.original.metrics?.readRecords),
      },
      {
        id: 'recordsOut',
        header: 'Records out',
        meta: { numeric: true, label: 'Records out', widthClass: 'w-28' },
        accessorFn: (row) => row.metrics?.writeRecords ?? 0,
        cell: ({ row }) => formatCompact(row.original.metrics?.writeRecords),
      },
      {
        id: 'bytesIn',
        header: 'Bytes in',
        meta: { numeric: true, label: 'Bytes in', widthClass: 'w-28' },
        accessorFn: (row) => row.metrics?.readBytes ?? 0,
        cell: ({ row }) => formatBytes(row.original.metrics?.readBytes),
      },
      {
        id: 'bytesOut',
        header: 'Bytes out',
        meta: { numeric: true, label: 'Bytes out', widthClass: 'w-28' },
        accessorFn: (row) => row.metrics?.writeBytes ?? 0,
        cell: ({ row }) => formatBytes(row.original.metrics?.writeBytes),
      },
      {
        id: 'busy',
        header: 'Busy',
        meta: { numeric: true, label: 'Busy', widthClass: 'w-32' },
        accessorFn: (row) => ratioPct(row.metrics?.accumulatedBusyTime, row.duration) ?? 0,
        cell: ({ row }) => (
          <PercentCell
            value={ratioPct(row.original.metrics?.accumulatedBusyTime, row.original.duration)}
          />
        ),
      },
      {
        id: 'backpressure',
        header: () => (
          <Tooltip content={LIFETIME_HELP}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">
              Backpressure (lifetime)
            </span>
          </Tooltip>
        ),
        meta: { numeric: true, label: 'Backpressure (lifetime)', widthClass: 'w-40' },
        accessorFn: (row) => ratioPct(row.metrics?.accumulatedBackpressuredTime, row.duration) ?? 0,
        cell: ({ row }) => (
          <PercentCell
            danger
            value={ratioPct(
              row.original.metrics?.accumulatedBackpressuredTime,
              row.original.duration,
            )}
          />
        ),
      },
      {
        id: 'backpressureCurrent',
        header: () => (
          <Tooltip content={CURRENT_HELP}>
            <span className="cursor-help underline decoration-dotted underline-offset-2">
              Backpressure (current)
            </span>
          </Tooltip>
        ),
        meta: { numeric: true, label: 'Backpressure (current)', widthClass: 'w-40' },
        accessorFn: (row) => currentBackpressurePct(bpByVertex[row.id]) ?? -1,
        cell: ({ row }) => {
          const sample = bpByVertex[row.original.id];
          const value = currentBackpressurePct(sample);
          const level = sample?.backpressureLevel?.toLowerCase();
          return (
            <div className="flex items-center justify-end gap-2">
              {level && level !== 'ok' ? (
                <Badge variant={level === 'high' ? 'danger' : 'warning'} size="sm">
                  {level}
                </Badge>
              ) : null}
              <PercentCell danger value={value} />
            </div>
          );
        },
      },
    ],
    [bpByVertex],
  );

  if (job.error) {
    return (
      <div>
        <PageHeader
          title="Job"
          description={jid}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={base}>
                <ArrowLeft /> Jobs
              </Link>
            </Button>
          }
        />
        <ErrorState error={job.error} onRetry={() => void job.refetch()} />
      </div>
    );
  }

  const duration = data ? liveDuration(data.startTime, data.endTime, data.duration, now) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={data?.name ?? 'Job'}
        description={
          <span className="inline-flex items-center gap-1">
            <span className="font-mono">{jid}</span>
            <CopyButton value={jid} tooltip="Copy job id" />
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {data ? (
              <StatusPill
                status={data.state}
                tone={flinkStateTone(data.state)}
                pulse={data.state === 'RUNNING'}
                label={data.state.toLowerCase()}
              />
            ) : null}
            {data?.jobType ? <Badge variant="secondary">{data.jobType.toLowerCase()}</Badge> : null}
            <Badge variant="outline">{formatDuration(duration)}</Badge>
          </div>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={base}>
                <ArrowLeft /> Jobs
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!running}
              onClick={() => setSavepointMode('trigger')}
            >
              <Camera /> Savepoint
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!running}
              onClick={() => setSavepointMode('stop')}
            >
              <OctagonX /> Stop
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!running}
              onClick={() => setCancelOpen(true)}
            >
              <XCircle /> Cancel
            </Button>
            <RefreshPicker onRefresh={() => void job.refetch()} refreshing={job.isFetching} />
          </>
        }
      />

      <StatTileRow columns={5}>
        <StatTile
          label="State"
          value={<span className="text-xl">{data?.state.toLowerCase() ?? '—'}</span>}
          tone={flinkStateTone(data?.state)}
          loading={job.isLoading}
        />
        <StatTile label="Duration" value={formatDuration(duration)} loading={job.isLoading} />
        <StatTile
          label="Vertices"
          value={formatCompact(data?.vertices?.length)}
          loading={job.isLoading}
        />
        <StatTile
          label="Tasks running"
          value={`${data?.statusCounts?.RUNNING ?? 0}/${Object.values(
            data?.statusCounts ?? {},
          ).reduce((a, b) => a + b, 0)}`}
          loading={job.isLoading}
        />
        <StatTile
          label="Started"
          value={
            <span className="text-sm">
              {data?.startTime && data.startTime > 0 ? formatTimestamp(data.startTime) : '—'}
            </span>
          }
          loading={job.isLoading}
        />
      </StatTileRow>

      {lastSavepoint ? (
        <SavepointStatusRow
          track={lastSavepoint}
          status={savepointStatus.data}
          error={savepointStatus.error}
          onDismiss={() => setLastSavepoint(null)}
        />
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          <Card>
            <CardToolbarHeader
              title="Vertices"
              description="Operator chains, throughput and pressure"
            />
            <CardContent>
              <DataTable
                columns={columns}
                data={data?.vertices ?? []}
                loading={job.isLoading}
                hideToolbar
                rowLabel="vertices"
                emptyState={<EmptyState compact title="No vertices" />}
              />
            </CardContent>
          </Card>
          <TaskStatusLegend />
          <p className="text-2xs text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">Backpressure</span> · lifetime =
            accumulated backpressured time ÷ vertex duration · current = highest sampled subtask
            ratio from the latest JobManager sample (cached 10s, only while the job is running).
          </p>
        </TabsContent>

        <TabsContent value="graph">
          <JobGraphTab cluster={cluster} flinkCluster={fc} job={data} />
        </TabsContent>

        <TabsContent value="checkpoints">
          <CheckpointsTab cluster={cluster} flinkCluster={fc} jid={jid} />
        </TabsContent>

        <TabsContent value="exceptions">
          <ExceptionsTab cluster={cluster} flinkCluster={fc} jid={jid} />
        </TabsContent>

        <TabsContent value="metrics">
          <JobMetricsTab cluster={cluster} flinkCluster={fc} jid={jid} job={data} />
        </TabsContent>
      </Tabs>

      <ConfirmDestructiveDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel job"
        description={
          <>
            Cancels <span className="font-mono">{data?.name}</span> immediately without taking a
            savepoint. In-flight state is lost.
          </>
        }
        confirmLabel="Cancel job"
        loading={jobAction.isPending}
        onConfirm={() =>
          jobAction.mutate(
            { jid, mode: 'cancel' },
            {
              onSuccess: () => {
                toast.success('Cancelling job');
                setCancelOpen(false);
              },
              onError: (e) => toastError('Cancel failed', e),
            },
          )
        }
      />

      <SavepointDialog
        open={savepointMode !== null}
        onOpenChange={(open) => !open && setSavepointMode(null)}
        mode={savepointMode ?? 'trigger'}
        jobName={data?.name ?? ''}
        loading={savepointMutation.isPending}
        onSubmit={({ targetDirectory, drain }) =>
          savepointMutation.mutate(
            {
              jid,
              targetDirectory,
              cancelJob: savepointMode === 'stop',
              drain: savepointMode === 'stop' ? drain : undefined,
            },
            {
              onSuccess: (res) => {
                const triggerId = res?.triggerId ?? res?.['request-id'] ?? null;
                toast.success(
                  savepointMode === 'stop' ? 'Stopping with savepoint' : 'Savepoint triggered',
                  triggerId ? { description: `Trigger id ${triggerId}` } : undefined,
                );
                if (triggerId) {
                  setLastSavepoint({
                    triggerId,
                    mode: savepointMode ?? 'trigger',
                    startedAt: Date.now(),
                  });
                }
                setSavepointMode(null);
              },
              onError: (e) => toastError('Savepoint failed', e),
            },
          )
        }
      />
    </div>
  );
}

/** Inline tracker for the most recent savepoint trigger (IN_PROGRESS → COMPLETED / FAILED). */
function SavepointStatusRow({
  track,
  status,
  error,
  onDismiss,
}: {
  track: SavepointTrack;
  status: ReturnType<typeof useFlinkSavepointStatus>['data'];
  error: unknown;
  onDismiss: () => void;
}) {
  const done = isSavepointDone(status);
  const failure = status?.operation?.failureCause ?? null;
  const location = status?.operation?.location ?? null;
  const failed = Boolean(failure) || (done && !location);
  const label = track.mode === 'stop' ? 'Stop with savepoint' : 'Savepoint';
  const cause =
    failure?.class ??
    failure?.stackTrace?.split('\n')[0] ??
    failure?.serializedThrowable ??
    (error instanceof Error ? error.message : null);

  return (
    <Card
      className="border-l-4"
      style={{
        borderLeftColor: failed ? 'var(--danger)' : done ? 'var(--success)' : 'var(--warning)',
      }}
    >
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        {!done && !error ? (
          <Loader2 className="size-4 animate-spin text-[var(--warning)]" />
        ) : failed ? (
          <TriangleAlert className="size-4 text-[var(--danger)]" />
        ) : (
          <CircleCheck className="size-4 text-[var(--success)]" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-medium">
            {label}{' '}
            <StatusPill
              status={failed ? 'FAILED' : done ? 'COMPLETED' : 'IN_PROGRESS'}
              tone={failed ? 'danger' : done ? 'success' : 'warning'}
              pulse={!done && !error}
              label={failed ? 'failed' : done ? 'completed' : 'in progress'}
            />
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-2xs text-[var(--muted)]">
            <span>
              trigger <span className="font-mono">{track.triggerId}</span>
            </span>
            <span>· started {formatTimestamp(track.startedAt)}</span>
            {location ? (
              <span className="inline-flex items-center gap-1">
                · path <span className="font-mono text-[var(--foreground)]">{location}</span>
                <CopyButton value={location} tooltip="Copy savepoint path" />
              </span>
            ) : null}
          </p>
          {failed && cause ? (
            <p className="font-mono text-2xs text-[var(--danger)]">{cause}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss savepoint status"
          onClick={onDismiss}
        >
          <X />
        </Button>
      </CardContent>
    </Card>
  );
}

export default FlinkJobPage;
