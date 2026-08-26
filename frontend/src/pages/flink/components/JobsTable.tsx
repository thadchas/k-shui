import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Camera, MoreHorizontal, OctagonX, Workflow, XCircle } from 'lucide-react';
import { useFlinkJobAction, useFlinkSavepoint } from '@/api/hooks/flink';
import type { FlinkJob } from '@/api/types';
import { formatDuration, formatTimestamp } from '@/lib/format';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { useUrlState } from '@/hooks/useUrlState';
import { Button } from '@/components/ui/button';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SimpleSelect } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { toast, toastError } from '@/components/ui/toast';
import { flinkStateTone, liveDuration, useNow } from '../flinkLib';
import { SavepointDialog, type SavepointMode } from './SavepointDialog';
import { TaskStatusBar } from './TaskStatusBar';

export interface JobsTableProps {
  cluster: string;
  flinkCluster: string;
  jobs: FlinkJob[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

const TERMINAL = /^(FINISHED|FAILED|CANCELED|CANCELLED|SUSPENDED)$/i;

const JOB_STATES = [
  'RUNNING',
  'RESTARTING',
  'CREATED',
  'FINISHED',
  'FAILED',
  'FAILING',
  'CANCELED',
  'CANCELLING',
  'SUSPENDED',
] as const;

export function JobsTable({
  cluster,
  flinkCluster,
  jobs,
  loading,
  error,
  onRetry,
}: JobsTableProps) {
  const now = useNow(1000);
  const { canEdit } = usePermissions();
  const [{ q: search, state: stateFilter }, setUrl] = useUrlState({ q: '', state: 'all' });
  const setSearch = (q: string) => setUrl({ q });
  const gate = canEdit ? {} : { disabled: true, title: REQUIRES_EDITOR };
  const gateHint = canEdit ? null : (
    <span className="ml-auto pl-3 text-2xs text-[var(--muted)]">{REQUIRES_EDITOR}</span>
  );
  const [cancelTarget, setCancelTarget] = useState<FlinkJob | null>(null);
  const [savepoint, setSavepoint] = useState<{ job: FlinkJob; mode: SavepointMode } | null>(null);

  const jobAction = useFlinkJobAction(cluster, flinkCluster);
  const savepointMutation = useFlinkSavepoint(cluster, flinkCluster);

  const rows = useMemo(() => {
    const list = jobs ?? [];
    if (stateFilter === 'all') return list;
    return list.filter((j) => j.state.toUpperCase() === stateFilter);
  }, [jobs, stateFilter]);

  const columns = useMemo<ColumnDef<FlinkJob>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Job',
        meta: { label: 'Job' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-[var(--foreground)]">
              {row.original.name}
            </p>
            <p className="truncate font-mono text-2xs text-[var(--muted)]">{row.original.jid}</p>
          </div>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        meta: { label: 'State', widthClass: 'w-32' },
        cell: ({ row }) => (
          <StatusPill
            status={row.original.state}
            tone={flinkStateTone(row.original.state)}
            pulse={row.original.state === 'RUNNING'}
            label={row.original.state.toLowerCase()}
          />
        ),
      },
      {
        id: 'tasks',
        header: 'Tasks',
        meta: { label: 'Tasks', widthClass: 'w-44' },
        cell: ({ row }) => (
          <TaskStatusBar tasks={row.original.tasks as unknown as Record<string, number>} />
        ),
      },
      {
        accessorKey: 'startTime',
        header: 'Started',
        meta: { label: 'Started', widthClass: 'w-44' },
        cell: ({ row }) => (
          <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
            {row.original.startTime > 0 ? formatTimestamp(row.original.startTime) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'duration',
        header: 'Duration',
        meta: { numeric: true, label: 'Duration', widthClass: 'w-28' },
        cell: ({ row }) =>
          formatDuration(
            liveDuration(row.original.startTime, row.original.endTime, row.original.duration, now),
          ),
      },
    ],
    [now],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search jobs…"
        rowLabel="jobs"
        caption={`Flink jobs on ${flinkCluster}`}
        defaultSorting={[{ id: 'startTime', desc: true }]}
        getRowHref={(job) =>
          `/c/${cluster}/flink/${encodeURIComponent(flinkCluster)}/jobs/${job.jid}`
        }
        toolbar={
          <SimpleSelect
            value={stateFilter}
            onValueChange={(state) => setUrl({ state })}
            options={[
              { label: 'All states', value: 'all' },
              ...JOB_STATES.map((s) => ({ label: s.toLowerCase(), value: s })),
            ]}
            aria-label="Filter by job state"
            className="w-40"
          />
        }
        rowActions={(job) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${job.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                {...gate}
                disabled={!canEdit || TERMINAL.test(job.state)}
                onSelect={() => setSavepoint({ job, mode: 'trigger' })}
              >
                <Camera /> Trigger savepoint{gateHint}
              </DropdownMenuItem>
              <DropdownMenuItem
                {...gate}
                disabled={!canEdit || TERMINAL.test(job.state)}
                onSelect={() => setSavepoint({ job, mode: 'stop' })}
              >
                <OctagonX /> Stop with savepoint{gateHint}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                {...gate}
                disabled={!canEdit || TERMINAL.test(job.state)}
                onSelect={() => setCancelTarget(job)}
              >
                <XCircle /> Cancel job{gateHint}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={Workflow}
            title={search || stateFilter !== 'all' ? 'No jobs match' : 'No jobs'}
            description={
              search || stateFilter !== 'all'
                ? 'Try a different search term.'
                : 'Submit a job through the SQL gateway or upload a JAR to get started.'
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel job"
        description={
          <>
            Cancels <span className="font-mono">{cancelTarget?.name}</span> immediately without
            taking a savepoint. In-flight state is lost.
          </>
        }
        confirmText={cancelTarget?.name || cancelTarget?.jid}
        confirmLabel="Cancel job"
        loading={jobAction.isPending}
        onConfirm={() => {
          if (!cancelTarget) return;
          jobAction.mutate(
            { jid: cancelTarget.jid, mode: 'cancel' },
            {
              onSuccess: () => {
                toast.success(`Cancelling ${cancelTarget.name}`);
                setCancelTarget(null);
              },
              onError: (e) => toastError('Cancel failed', e),
            },
          );
        }}
      />

      <SavepointDialog
        open={Boolean(savepoint)}
        onOpenChange={(open) => !open && setSavepoint(null)}
        mode={savepoint?.mode ?? 'trigger'}
        jobName={savepoint?.job.name ?? ''}
        loading={savepointMutation.isPending}
        onSubmit={({ targetDirectory, drain }) => {
          if (!savepoint) return;
          savepointMutation.mutate(
            {
              jid: savepoint.job.jid,
              targetDirectory,
              cancelJob: savepoint.mode === 'stop',
              drain: savepoint.mode === 'stop' ? drain : undefined,
            },
            {
              onSuccess: (res) => {
                const id = res?.['request-id'];
                toast.success(
                  savepoint.mode === 'stop' ? 'Stopping with savepoint' : 'Savepoint triggered',
                  id ? { description: `Trigger id ${id}` } : undefined,
                );
                setSavepoint(null);
              },
              onError: (e) => toastError('Savepoint failed', e),
            },
          );
        }}
      />
    </>
  );
}
