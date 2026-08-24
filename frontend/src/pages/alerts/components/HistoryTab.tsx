import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { BellOff, Check, CircleCheck, Radio } from 'lucide-react';
import { useAckAlert, useAlertHistory, useAlertLiveUpdates } from '@/api/hooks/alerts';
import { useClusters } from '@/api/hooks/clusters';
import type { AlertComponent, AlertHistoryEntry } from '@/api/types';
import { formatDecimal, formatDuration, formatRelative, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SimpleSelect } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip } from '@/components/ui/tooltip';
import { toast, toastError } from '@/components/ui/toast';
import {
  COMPONENTS,
  componentIcon,
  isAlertsUnavailable,
  severityTone,
} from '../alertsLib';

const STATUSES = [
  { label: 'All statuses', value: 'all' },
  { label: 'Firing', value: 'firing' },
  { label: 'Resolved', value: 'resolved' },
];

const SINCE = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'All time', value: 'all' },
];

function notificationTone(entry: AlertHistoryEntry): {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'secondary';
} {
  const notes = entry.notifications ?? [];
  if (notes.length === 0) return { label: 'none', variant: 'secondary' };
  const failed = notes.filter((n) => n.status !== 'sent' && n.status !== 'ok');
  if (failed.length === 0) return { label: `${notes.length} sent`, variant: 'success' };
  if (failed.length === notes.length) return { label: 'failed', variant: 'danger' };
  return { label: `${failed.length} failed`, variant: 'warning' };
}

export function HistoryTab() {
  const [status, setStatus] = useState('all');
  const [component, setComponent] = useState('all');
  const [clusterId, setClusterId] = useState('all');
  const [since, setSince] = useState('7d');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const clusters = useClusters();
  const ack = useAckAlert();

  const history = useAlertHistory({
    status: status === 'all' ? undefined : (status as 'firing' | 'resolved'),
    component: component === 'all' ? undefined : (component as AlertComponent),
    clusterId: clusterId === 'all' ? undefined : clusterId,
    since: since === 'all' ? undefined : since,
    page,
    perPage,
  });

  useAlertLiveUpdates(!isAlertsUnavailable(history.error));

  const { items, total } = useMemo(() => {
    const raw = history.data;
    if (!raw) return { items: [] as AlertHistoryEntry[], total: 0 };
    if (Array.isArray(raw)) return { items: raw, total: raw.length };
    return { items: raw.items ?? [], total: raw.total ?? raw.items?.length ?? 0 };
  }, [history.data]);

  const columns = useMemo<ColumnDef<AlertHistoryEntry>[]>(
    () => [
      {
        accessorKey: 'severity',
        header: 'Severity',
        meta: { label: 'Severity', widthClass: 'w-28' },
        cell: ({ row }) => (
          <StatusPill
            status={row.original.severity}
            tone={severityTone(row.original.severity)}
            pulse={row.original.status === 'firing'}
          />
        ),
      },
      {
        accessorKey: 'triggerName',
        header: 'Trigger',
        meta: { label: 'Trigger' },
        cell: ({ row }) => {
          const Icon = componentIcon(row.original.component);
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{row.original.triggerName}</p>
                <p className="truncate font-mono text-2xs text-[var(--muted)]">
                  {row.original.target ?? row.original.component}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'clusterId',
        header: 'Cluster',
        meta: { label: 'Cluster', widthClass: 'w-36' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-2xs text-[var(--muted)]">
            {row.original.clusterId ?? '—'}
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        meta: { numeric: true, label: 'Value', widthClass: 'w-40' },
        accessorFn: (row) => row.value,
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            <span
              className={cn(
                row.original.status === 'firing' ? 'text-[var(--danger)]' : undefined,
              )}
            >
              {formatDecimal(row.original.value)}
            </span>
            <span className="text-[var(--muted)]">
              {' '}
              vs {formatDecimal(row.original.threshold)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'firedAt',
        header: 'Fired',
        meta: { label: 'Fired', widthClass: 'w-40' },
        cell: ({ row }) => (
          <Tooltip content={formatTimestamp(row.original.firedAt)}>
            <span className="text-2xs text-[var(--muted)]">
              {formatRelative(row.original.firedAt)}
            </span>
          </Tooltip>
        ),
      },
      {
        id: 'resolved',
        header: 'Resolved',
        meta: { label: 'Resolved', widthClass: 'w-40' },
        accessorFn: (row) => row.resolvedAt ?? '',
        cell: ({ row }) => {
          if (!row.original.resolvedAt) {
            return (
              <Badge variant="danger" size="sm">
                firing
              </Badge>
            );
          }
          const ms =
            new Date(row.original.resolvedAt).getTime() -
            new Date(row.original.firedAt).getTime();
          return (
            <Tooltip content={formatTimestamp(row.original.resolvedAt)}>
              <span className="text-2xs text-[var(--muted)]">
                after {formatDuration(Number.isFinite(ms) ? ms : null)}
              </span>
            </Tooltip>
          );
        },
      },
      {
        id: 'notifications',
        header: 'Notifications',
        meta: { label: 'Notifications', widthClass: 'w-32' },
        cell: ({ row }) => {
          const tone = notificationTone(row.original);
          return (
            <Tooltip
              content={
                (row.original.notifications ?? [])
                  .map((n) => `${n.actionId}: ${n.status}${n.error ? ` (${n.error})` : ''}`)
                  .join('\n') || 'No notifications sent'
              }
            >
              <Badge variant={tone.variant} size="sm">
                {tone.label}
              </Badge>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  if (isAlertsUnavailable(history.error)) {
    return (
      <EmptyState
        icon={BellOff}
        title="Alerting is not enabled"
        description="This k-shui deployment does not expose the alerts API. Enable the alerts engine in the backend configuration to record trigger history here."
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={items}
      loading={history.isLoading}
      error={history.error}
      onRetry={() => void history.refetch()}
      hideToolbar={false}
      searchPlaceholder="Search alerts…"
      rowLabel="alerts"
      page={page}
      perPage={perPage}
      total={total}
      onPageChange={setPage}
      defaultSorting={[{ id: 'firedAt', desc: true }]}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <SimpleSelect
            className="w-36"
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUSES}
            aria-label="Filter by status"
          />
          <SimpleSelect
            className="w-44"
            value={component}
            onValueChange={(v) => {
              setComponent(v);
              setPage(1);
            }}
            options={[
              { label: 'All components', value: 'all' },
              ...COMPONENTS.map((c) => ({ label: c.label, value: c.value })),
            ]}
            aria-label="Filter by component"
          />
          <SimpleSelect
            className="w-44"
            value={clusterId}
            onValueChange={(v) => {
              setClusterId(v);
              setPage(1);
            }}
            options={[
              { label: 'All clusters', value: 'all' },
              ...(clusters.data ?? []).map((c) => ({ label: c.name, value: c.id })),
            ]}
            aria-label="Filter by cluster"
          />
          <SimpleSelect
            className="w-40"
            value={since}
            onValueChange={(v) => {
              setSince(v);
              setPage(1);
            }}
            options={SINCE}
            aria-label="Filter by time"
          />
          <span className="inline-flex items-center gap-1.5 text-2xs text-[var(--muted)]">
            <Radio className="size-3 text-[var(--success)]" /> live
          </span>
        </div>
      }
      rowActions={(entry) =>
        entry.status === 'firing' ? (
          <Button
            variant="ghost"
            size="sm"
            loading={ack.isPending && ack.variables === entry.id}
            onClick={() =>
              ack.mutate(entry.id, {
                onSuccess: () => toast.success('Alert acknowledged'),
                onError: (e) => toastError('Acknowledge failed', e),
              })
            }
          >
            <Check /> Ack
          </Button>
        ) : null
      }
      emptyState={
        <EmptyState
          icon={CircleCheck}
          title="No alerts in this window"
          description="Nothing has fired for the selected filters — that is usually good news."
        />
      }
    />
  );
}
