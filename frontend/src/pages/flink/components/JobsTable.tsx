import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Camera, MoreHorizontal, OctagonX, Workflow, XCircle } from 'lucide-react';
import { useFlinkJobAction, useFlinkSavepoint } from '@/api/hooks/flink';
import type { FlinkJob } from '@/api/types';
import { formatDuration, formatTimestamp } from '@/lib/format';
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

export function JobsTable({
  cluster,
  flinkCluster,
  jobs,
  loading,
  error,
  onRetry,
}: JobsTableProps) {
  const navigate = useNavigate();
  const now = useNow(1000);
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState<FlinkJob | null>(null);
  const [savepoint, setSavepoint] = useState<{ job: FlinkJob; mode: SavepointMode } | null>(null);

  const jobAction = useFlinkJobAction(cluster, flinkCluster);
  const savepointMutation = useFlinkSavepoint(cluster, flinkCluster);

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
            liveDuration(
              row.original.startTime,
              row.original.endTime,
              row.original.duration,
              now,
            ),
          ),
      },
    ],
    [now],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={jobs ?? []}
        loading={loading}
        error={error}
        onRetry={onRetry}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search jobs…"
        rowLabel="jobs"
        defaultSorting={[{ id: 'startTime', desc: true }]}
        onRowClick={(job) =>
          void navigate(`/c/${cluster}/flink/${flinkCluster}/jobs/${job.jid}`)
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
                disabled={TERMINAL.test(job.state)}
                onSelect={() => setSavepoint({ job, mode: 'trigger' })}
              >
                <Camera /> Trigger savepoint
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={TERMINAL.test(job.state)}
                onSelect={() => setSavepoint({ job, mode: 'stop' })}
              >
                <OctagonX /> Stop with savepoint
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={TERMINAL.test(job.state)}
                onSelect={() => setCancelTarget(job)}
              >
                <XCircle /> Cancel job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={Workflow}
            title={search ? 'No jobs match' : 'No jobs'}
            description={
              search
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
