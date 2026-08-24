import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { BellOff, Copy, MoreHorizontal, Pencil, Siren, Trash2 } from 'lucide-react';
import {
  useAlertActions,
  useAlertTriggers,
  useCreateAlertTrigger,
  useDeleteAlertTrigger,
  useToggleAlertTrigger,
} from '@/api/hooks/alerts';
import type { AlertTrigger } from '@/api/types';
import { formatDecimal, formatRelative } from '@/lib/format';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import {
  componentIcon,
  componentLabel,
  conditionSymbol,
  isAlertsUnavailable,
  severityTone,
} from '../alertsLib';

export function TriggersTab() {
  const navigate = useNavigate();
  const triggers = useAlertTriggers();
  const actions = useAlertActions();
  const toggle = useToggleAlertTrigger();
  const remove = useDeleteAlertTrigger();
  const create = useCreateAlertTrigger();
  const [search, setSearch] = useState('');
  const { canEdit } = usePermissions();
  const [deleteTarget, setDeleteTarget] = useState<AlertTrigger | null>(null);

  const actionNames = useMemo(
    () => new Map((actions.data ?? []).map((a) => [a.id, a.name])),
    [actions.data],
  );

  const columns = useMemo<ColumnDef<AlertTrigger>[]>(
    () => [
      {
        id: 'enabled',
        header: 'On',
        meta: { label: 'Enabled', widthClass: 'w-16', stopRowClick: true },
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            aria-label={`Toggle ${row.original.name}`}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) =>
              toggle.mutate(
                { id: row.original.id, enabled: checked },
                {
                  onSuccess: () => toast.success(checked ? 'Trigger enabled' : 'Trigger disabled'),
                  onError: (e) => toastError('Could not update trigger', e),
                },
              )
            }
          />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Trigger',
        meta: { label: 'Trigger' },
        cell: ({ row }) => {
          const Icon = componentIcon(row.original.component);
          return (
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{row.original.name}</p>
                <p className="truncate text-2xs text-[var(--muted)]">
                  {componentLabel(row.original.component)}
                  {row.original.target?.name || row.original.target?.regex
                    ? ` · ${row.original.target.regex ?? row.original.target.name}`
                    : ''}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        meta: { label: 'Severity', widthClass: 'w-28' },
        cell: ({ row }) => (
          <StatusPill status={row.original.severity} tone={severityTone(row.original.severity)} />
        ),
      },
      {
        id: 'condition',
        header: 'Condition',
        meta: { label: 'Condition' },
        cell: ({ row }) => (
          <span className="font-mono text-2xs">
            {row.original.metric} {conditionSymbol(row.original.condition)}{' '}
            {formatDecimal(row.original.value)}
            {row.original.bufferSeconds > 0 ? (
              <span className="text-[var(--muted)]"> for {row.original.bufferSeconds}s</span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'clusterId',
        header: 'Cluster',
        meta: { label: 'Cluster', widthClass: 'w-36' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-2xs text-[var(--muted)]">
            {row.original.clusterId ?? 'all'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Notifies',
        meta: { label: 'Notifies', widthClass: 'w-44' },
        cell: ({ row }) =>
          (row.original.actionIds ?? []).length === 0 ? (
            <span className="text-2xs text-[var(--muted)]">none</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.actionIds.slice(0, 2).map((id) => (
                <Badge key={id} variant="secondary" size="sm">
                  {actionNames.get(id) ?? id}
                </Badge>
              ))}
              {row.original.actionIds.length > 2 ? (
                <Badge variant="outline" size="sm">
                  +{row.original.actionIds.length - 2}
                </Badge>
              ) : null}
            </div>
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        meta: { label: 'Updated', widthClass: 'w-36' },
        cell: ({ row }) => (
          <span className="text-2xs text-[var(--muted)]">
            {row.original.updatedAt ? formatRelative(row.original.updatedAt) : '—'}
          </span>
        ),
      },
    ],
    [actionNames, toggle],
  );

  if (isAlertsUnavailable(triggers.error)) {
    return (
      <EmptyState
        icon={BellOff}
        title="Alerting is not enabled"
        description="This k-shui deployment does not expose the alerts API, so triggers cannot be managed here."
      />
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={triggers.data ?? []}
        loading={triggers.isLoading}
        error={triggers.error}
        onRetry={() => void triggers.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search triggers…"
        rowLabel="triggers"
        onRowClick={(t) => void navigate(`/alerts/triggers/${encodeURIComponent(t.id)}`)}
        rowActions={(trigger) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${trigger.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => void navigate(`/alerts/triggers/${encodeURIComponent(trigger.id)}`)}
              >
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  create.mutate(
                    {
                      name: `${trigger.name} (copy)`,
                      clusterId: trigger.clusterId,
                      component: trigger.component,
                      target: trigger.target ?? {},
                      metric: trigger.metric,
                      condition: trigger.condition,
                      value: trigger.value,
                      bufferSeconds: trigger.bufferSeconds,
                      severity: trigger.severity,
                      enabled: false,
                      actionIds: trigger.actionIds ?? [],
                    },
                    {
                      onSuccess: () => toast.success('Trigger duplicated (disabled)'),
                      onError: (e) => toastError('Duplicate failed', e),
                    },
                  )
                }
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={!canEdit}
                title={canEdit ? undefined : REQUIRES_EDITOR}
                onSelect={() => setDeleteTarget(trigger)}
              >
                <Trash2 /> Delete
                {!canEdit ? (
                  <span className="ml-auto pl-3 text-2xs text-[var(--muted)]">
                    {REQUIRES_EDITOR}
                  </span>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={Siren}
            title={search ? 'No triggers match' : 'No triggers yet'}
            description={
              search
                ? 'Try a different search term.'
                : 'Create a trigger to be notified when a cluster, topic, consumer group, connector or job misbehaves.'
            }
            action={
              <Button onClick={() => void navigate('/alerts/triggers/new')}>New trigger</Button>
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete trigger"
        description={
          <>
            Permanently removes <span className="font-mono">{deleteTarget?.name}</span> and stops
            all evaluation. Recorded history is kept.
          </>
        }
        confirmText={deleteTarget?.name}
        confirmLabel="Delete trigger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('Trigger deleted');
              setDeleteTarget(null);
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </>
  );
}
