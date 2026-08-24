import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowLeft,
  Cable,
  Pause,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import {
  useConnectCluster,
  useConnectClusters,
  useConnectorAction,
  useConnectors,
  useDeleteConnector,
  type ConnectorAction,
} from '@/api/hooks/connect';
import type { Connector } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { SimpleSelect } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import {
  ACTION_PAST_TENSE,
  ConnectorActionsMenu,
  StopConnectorDialog,
} from './components/ConnectorActions';
import { TasksMiniBar } from './components/TasksMiniBar';
import {
  CONNECTOR_STATES,
  connectorStateTone,
  shortClass,
  taskCounts,
} from './components/connectUtils';

export function ConnectClusterPage() {
  const cluster = useClusterId();
  const { kc: kcParam = '' } = useParams<{ kc: string }>();
  const kc = decodeURIComponent(kcParam);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkStop, setBulkStop] = useState(false);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      state: stateFilter === 'all' ? undefined : stateFilter,
      type: typeFilter === 'all' ? undefined : typeFilter,
    }),
    [debouncedSearch, stateFilter, typeFilter],
  );

  const connectClusters = useConnectClusters(cluster);
  const connect = useConnectCluster(cluster, kc);
  const connectors = useConnectors(cluster, kc, query);
  const action = useConnectorAction(cluster, kc);
  const remove = useDeleteConnector(cluster, kc);

  const rows = useMemo(() => connectors.data ?? [], [connectors.data]);
  const base = `/c/${cluster}/connect/${encodeURIComponent(kc)}`;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));
  const someSelected = rows.some((r) => selected.has(r.name));

  const columns = useMemo<ColumnDef<Connector>[]>(
    () => [
      {
        id: '__select',
        enableSorting: false,
        enableHiding: false,
        meta: { widthClass: 'w-9', stopRowClick: true },
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(v) =>
              setSelected(v ? new Set(rows.map((r) => r.name)) : new Set<string>())
            }
            aria-label="Select all connectors"
          />
        ),
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected.has(row.original.name)}
              onCheckedChange={() => toggle(row.original.name)}
              aria-label={`Select ${row.original.name}`}
            />
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Connector',
        meta: { label: 'Connector' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-[13px] font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        meta: { label: 'Type', widthClass: 'w-24' },
        cell: ({ row }) => (
          <Badge variant={row.original.type === 'source' ? 'accent' : 'info'} size="sm">
            {row.original.type}
          </Badge>
        ),
      },
      {
        accessorKey: 'connectorClass',
        header: 'Class',
        meta: { label: 'Class' },
        cell: ({ row }) => (
          <Tooltip content={<span className="font-mono">{row.original.connectorClass}</span>}>
            <span className="truncate font-mono text-2xs text-[var(--muted)]">
              {shortClass(row.original.connectorClass)}
            </span>
          </Tooltip>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        meta: { label: 'State', widthClass: 'w-32' },
        cell: ({ row }) => (
          <StatusPill
            status={row.original.state}
            tone={connectorStateTone(row.original.state)}
            pulse={(row.original.state ?? '').toUpperCase() === 'RESTARTING'}
          />
        ),
      },
      {
        id: 'tasks',
        header: 'Tasks',
        meta: { label: 'Tasks', widthClass: 'w-44' },
        cell: ({ row }) => <TasksMiniBar tasks={row.original.tasks} />,
      },
      {
        id: 'topics',
        header: 'Topics',
        meta: { label: 'Topics' },
        cell: ({ row }) => {
          const topics = row.original.topics ?? [];
          if (topics.length === 0) return <span className="text-[var(--muted)]">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {topics.slice(0, 2).map((topic) => (
                <Link
                  key={topic}
                  to={`/c/${cluster}/topics/${encodeURIComponent(topic)}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge variant="secondary" size="sm" className="max-w-40 truncate font-mono">
                    {topic}
                  </Badge>
                </Link>
              ))}
              {topics.length > 2 ? (
                <Tooltip content={topics.slice(2).join(', ')}>
                  <Badge variant="outline" size="sm">
                    +{topics.length - 2}
                  </Badge>
                </Tooltip>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'workerId',
        header: 'Worker',
        meta: { label: 'Worker' },
        cell: ({ row }) =>
          row.original.workerId ? (
            <Tooltip content={row.original.workerId}>
              <span className="truncate font-mono text-2xs text-[var(--muted)]">
                {row.original.workerId}
              </span>
            </Tooltip>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          ),
      },
    ],
    [allSelected, someSelected, rows, selected, cluster],
  );

  const selectedFailedTasks = rows
    .filter((r) => selected.has(r.name))
    .reduce((sum, r) => sum + taskCounts(r.tasks).failed, 0);

  const runBulk = async (kind: ConnectorAction, options?: { onlyFailed?: boolean }) => {
    const names = Array.from(selected);
    const results = await Promise.allSettled(
      names.map((name) =>
        action.mutateAsync({
          name,
          action: kind,
          includeTasks: kind === 'restart' ? true : undefined,
          onlyFailed: options?.onlyFailed,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const noun = `${names.length} connector${names.length === 1 ? '' : 's'}`;
    if (failed === 0) {
      toast.success(
        options?.onlyFailed
          ? `Restarted failed tasks on ${noun}`
          : `${noun} ${ACTION_PAST_TENSE[kind]}`,
      );
    } else {
      toast.error(`${failed} of ${names.length} connectors failed to ${kind}`);
    }
    void connectors.refetch();
    return failed === 0;
  };

  const clusterMissing =
    !connect.isLoading &&
    !connectClusters.error &&
    (connectClusters.data?.length ?? 0) > 0 &&
    !connect.data;

  return (
    <div>
      <PageHeader
        title={kc}
        description={
          connect.data
            ? `${connect.data.url} · v${connect.data.version ?? '—'} · ${connect.data.connectorCount} connectors`
            : 'Kafka Connect cluster'
        }
        meta={connect.data ? <StatusPill status={connect.data.status} /> : null}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/c/${cluster}/connect`}>
                <ArrowLeft /> All Connect clusters
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`${base}/plugins`}>
                <Puzzle /> Plugins
              </Link>
            </Button>
            <Button asChild>
              <Link to={`${base}/connectors/new`}>
                <Plus /> New connector
              </Link>
            </Button>
            <RefreshPicker
              onRefresh={() => {
                void connectors.refetch();
                void connectClusters.refetch();
              }}
              refreshing={connectors.isFetching}
            />
          </>
        }
      />

      {clusterMissing ? (
        <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Cable}
            compact
            title={`Unknown Connect cluster “${kc}”`}
            description="It is not present in this cluster's configuration."
            action={
              <Button asChild variant="outline">
                <Link to={`/c/${cluster}/connect`}>Back to Connect</Link>
              </Button>
            }
          />
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-3 py-2">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => void runBulk('resume')}>
            <Play /> Resume
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runBulk('pause')}>
            <Pause /> Pause
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkStop(true)}>
            <Square /> Stop
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runBulk('restart')}>
            <RotateCcw /> Restart
          </Button>
          <Tooltip
            content={
              selectedFailedTasks === 0
                ? 'No failed tasks in the selection'
                : `Restart ${selectedFailedTasks} failed task${selectedFailedTasks === 1 ? '' : 's'} only`
            }
          >
            <Button
              size="sm"
              variant="outline"
              disabled={selectedFailedTasks === 0}
              onClick={() => void runBulk('restart', { onlyFailed: true })}
            >
              <RefreshCw /> Restart failed tasks
            </Button>
          </Tooltip>
          <Button size="sm" variant="destructive" onClick={() => setBulkDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={rows}
        loading={connectors.isLoading}
        error={connectors.error}
        onRetry={() => void connectors.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search connectors…"
        defaultSorting={[{ id: 'name', desc: false }]}
        isRowSelected={(row) => selected.has(row.name)}
        onRowClick={(connector) =>
          void navigate(`${base}/connectors/${encodeURIComponent(connector.name)}`)
        }
        rowActions={(connector) => (
          <ConnectorActionsMenu
            cluster={cluster}
            kc={kc}
            connector={connector}
            onDeleted={() => void connectors.refetch()}
          />
        )}
        rowLabel="connectors"
        toolbar={
          <>
            <SimpleSelect
              value={stateFilter}
              onValueChange={setStateFilter}
              options={[
                { label: 'All states', value: 'all' },
                ...CONNECTOR_STATES.map((s) => ({ label: s, value: s })),
              ]}
              aria-label="Filter by state"
              className="w-40"
            />
            <SimpleSelect
              value={typeFilter}
              onValueChange={setTypeFilter}
              options={[
                { label: 'All types', value: 'all' },
                { label: 'source', value: 'source' },
                { label: 'sink', value: 'sink' },
              ]}
              aria-label="Filter by type"
              className="w-36"
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Cable}
            title={
              search || stateFilter !== 'all' || typeFilter !== 'all'
                ? 'No connectors match your filters'
                : 'No connectors yet'
            }
            description={
              search || stateFilter !== 'all' || typeFilter !== 'all'
                ? 'Try clearing the search or filters.'
                : 'Create a connector to move data in or out of Kafka.'
            }
            action={
              <Button asChild>
                <Link to={`${base}/connectors/new`}>
                  <Plus /> New connector
                </Link>
              </Button>
            }
          />
        }
      />

      <StopConnectorDialog
        open={bulkStop}
        onOpenChange={setBulkStop}
        connectorName={
          selected.size === 1
            ? Array.from(selected)[0]
            : `${selected.size} selected connector${selected.size === 1 ? '' : 's'}`
        }
        loading={action.isPending}
        onConfirm={async () => {
          if (await runBulk('stop')) setBulkStop(false);
        }}
      />

      <ConfirmDestructiveDialog
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${selected.size} connector${selected.size === 1 ? '' : 's'}`}
        description={
          <>
            Removes {Array.from(selected).slice(0, 5).join(', ')}
            {selected.size > 5 ? ` and ${selected.size - 5} more` : ''} from{' '}
            <span className="font-mono">{kc}</span> and stops all of their tasks.
          </>
        }
        confirmLabel="Delete connectors"
        loading={remove.isPending}
        onConfirm={async () => {
          const names = Array.from(selected);
          const results = await Promise.allSettled(names.map((name) => remove.mutateAsync(name)));
          const failed = results.filter((r) => r.status === 'rejected');
          if (failed.length === 0) toast.success(`${names.length} connector(s) deleted`);
          else toastError(`${failed.length} of ${names.length} deletes failed`, failed[0].reason);
          setSelected(new Set());
          setBulkDelete(false);
          void connectors.refetch();
        }}
      />
    </div>
  );
}

export default ConnectClusterPage;
