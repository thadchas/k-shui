import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { BellOff, MoreHorizontal, Pencil, Send, Trash2, Webhook } from 'lucide-react';
import {
  useAlertActions,
  useAlertTriggers,
  useDeleteAlertAction,
  useTestAlertAction,
} from '@/api/hooks/alerts';
import type { AlertAction } from '@/api/types';
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
import { toast, toastError } from '@/components/ui/toast';
import { ACTION_TYPES, actionTypeIcon, isAlertsUnavailable } from '../alertsLib';

function describeConfig(action: AlertAction): string {
  const c = action.config ?? {};
  const pick = (key: string) => (typeof c[key] === 'string' ? (c[key] as string) : undefined);
  switch (action.type) {
    case 'email':
      return pick('recipients') ?? pick('to') ?? '—';
    case 'slack':
    case 'teams':
    case 'webhook':
      return pick('url') ?? pick('webhookUrl') ?? '—';
    case 'pagerduty':
      return pick('routingKey') ? '••••••••' : '—';
    default:
      return '—';
  }
}

export function ActionsTab() {
  const navigate = useNavigate();
  const actions = useAlertActions();
  const triggers = useAlertTriggers();
  const test = useTestAlertAction();
  const remove = useDeleteAlertAction();
  const [search, setSearch] = useState('');
  const { canEdit } = usePermissions();
  const [deleteTarget, setDeleteTarget] = useState<AlertAction | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of triggers.data ?? []) {
      for (const id of t.actionIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [triggers.data]);

  const columns = useMemo<ColumnDef<AlertAction>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Action',
        meta: { label: 'Action' },
        cell: ({ row }) => {
          const Icon = actionTypeIcon(row.original.type);
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-2)]">
                <Icon className="size-3.5 text-[var(--primary)]" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{row.original.name}</p>
                <p className="truncate font-mono text-2xs text-[var(--muted)]">
                  {describeConfig(row.original)}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'type',
        header: 'Type',
        meta: { label: 'Type', widthClass: 'w-40' },
        cell: ({ row }) => (
          <Badge variant="secondary" size="sm">
            {ACTION_TYPES.find((a) => a.value === row.original.type)?.label ?? row.original.type}
          </Badge>
        ),
      },
      {
        id: 'usage',
        header: 'Used by',
        meta: { numeric: true, label: 'Used by', widthClass: 'w-28' },
        accessorFn: (row) => usage.get(row.id) ?? 0,
        cell: ({ row }) => {
          const n = usage.get(row.original.id) ?? 0;
          return n === 0 ? (
            <span className="text-2xs text-[var(--muted)]">unused</span>
          ) : (
            `${n} trigger${n === 1 ? '' : 's'}`
          );
        },
      },
      {
        accessorKey: 'enabled',
        header: 'Status',
        meta: { label: 'Status', widthClass: 'w-28' },
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? 'success' : 'secondary'} size="sm">
            {row.original.enabled ? 'enabled' : 'disabled'}
          </Badge>
        ),
      },
      {
        id: 'test',
        header: '',
        meta: { label: 'Test', widthClass: 'w-24', stopRowClick: true },
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            loading={test.isPending && test.variables === row.original.id}
            onClick={(e) => {
              e.stopPropagation();
              test.mutate(row.original.id, {
                onSuccess: (result) => {
                  const ok = result?.ok !== false && result?.status !== 'error';
                  if (ok)
                    toast.success(`Test sent to ${row.original.name}`, {
                      description: result?.message,
                    });
                  else
                    toast.error(`Test failed for ${row.original.name}`, {
                      description: result?.error ?? result?.message,
                    });
                },
                onError: (err) => toastError('Test failed', err),
              });
            }}
          >
            <Send /> Test
          </Button>
        ),
      },
    ],
    [test, usage],
  );

  if (isAlertsUnavailable(actions.error)) {
    return (
      <EmptyState
        icon={BellOff}
        title="Alerting is not enabled"
        description="This k-shui deployment does not expose the alerts API, so notification actions cannot be managed here."
      />
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={actions.data ?? []}
        loading={actions.isLoading}
        error={actions.error}
        onRetry={() => void actions.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search actions…"
        rowLabel="actions"
        onRowClick={(a) => void navigate(`/alerts/actions/new?id=${encodeURIComponent(a.id)}`)}
        rowActions={(action) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${action.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  void navigate(`/alerts/actions/new?id=${encodeURIComponent(action.id)}`)
                }
              >
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={!canEdit}
                title={canEdit ? undefined : REQUIRES_EDITOR}
                onSelect={() => setDeleteTarget(action)}
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
            icon={Webhook}
            title={search ? 'No actions match' : 'No notification actions'}
            description={
              search
                ? 'Try a different search term.'
                : 'Add an email, Slack, PagerDuty, Teams or webhook action so triggers can notify someone.'
            }
            action={
              <Button onClick={() => void navigate('/alerts/actions/new')}>New action</Button>
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete action"
        description={
          <>
            Permanently removes <span className="font-mono">{deleteTarget?.name}</span>. Triggers
            referencing it will stop notifying.
          </>
        }
        confirmText={deleteTarget?.name}
        confirmLabel="Delete action"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('Action deleted');
              setDeleteTarget(null);
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </>
  );
}
