import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { useAudit } from '@/api/hooks/system';
import { useClusters } from '@/api/hooks/clusters';
import type { AuditEntry } from '@/api/types';
import { useDebounced } from '@/hooks/useDebounced';
import { useUrlState } from '@/hooks/useUrlState';
import { formatRelative, formatTimestamp, truncate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';

function detailText(details: AuditEntry['details']): string {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return '';
  }
}

export function AuditPage() {
  const [{ page, perPage, user, action, cluster: clusterId }, setUrl] = useUrlState({
    page: 1,
    perPage: 50,
    user: '',
    action: '',
    cluster: 'all',
  });

  const debouncedUser = useDebounced(user, 300);
  const debouncedAction = useDebounced(action, 300);
  const clusters = useClusters();

  const { data, isLoading, error, refetch } = useAudit({
    page,
    perPage,
    user: debouncedUser || undefined,
    action: debouncedAction || undefined,
    clusterId: clusterId === 'all' ? undefined : clusterId,
  });

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'ts',
        header: 'When',
        meta: { label: 'When', widthClass: 'w-44' },
        cell: ({ row }) => (
          <Tooltip content={formatTimestamp(row.original.ts)}>
            <span className="text-xs text-[var(--muted)]">{formatRelative(row.original.ts)}</span>
          </Tooltip>
        ),
      },
      {
        accessorKey: 'user',
        header: 'User',
        meta: { label: 'User', widthClass: 'w-40' },
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.user}</span>,
      },
      {
        accessorKey: 'action',
        header: 'Action',
        meta: { label: 'Action', widthClass: 'w-56' },
        cell: ({ row }) => (
          <Badge variant="secondary" size="sm">
            {row.original.action}
          </Badge>
        ),
      },
      {
        accessorKey: 'resource',
        header: 'Resource',
        meta: { label: 'Resource' },
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.resource}</span>,
      },
      {
        accessorKey: 'clusterId',
        header: 'Cluster',
        meta: { label: 'Cluster', widthClass: 'w-32' },
        cell: ({ row }) =>
          row.original.clusterId ? (
            <span className="text-xs text-[var(--muted)]">{row.original.clusterId}</span>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          ),
      },
      {
        id: 'details',
        header: 'Details',
        meta: { label: 'Details' },
        cell: ({ row }) => {
          const text = detailText(row.original.details);
          if (!text) return <span className="text-[var(--muted)]">—</span>;
          return (
            <Tooltip
              content={<span className="font-mono text-2xs break-all">{truncate(text, 400)}</span>}
            >
              <span className="block max-w-md truncate font-mono text-xs text-[var(--muted)]">
                {text}
              </span>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: 'ip',
        header: 'IP',
        meta: { label: 'IP', widthClass: 'w-32' },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-[var(--muted)]">{row.original.ip ?? '—'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader title="Audit log" description="Every mutating action performed through k-shui." />
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        page={page}
        perPage={perPage}
        total={data?.total ?? 0}
        onPageChange={(p) => setUrl({ page: p })}
        onPerPageChange={(n) => setUrl({ perPage: n, page: 1 })}
        caption="Audit log entries"
        rowLabel="entries"
        toolbar={
          <>
            <Input
              className="w-40"
              value={user}
              onChange={(e) => setUrl({ user: e.target.value, page: 1 })}
              placeholder="User…"
              aria-label="Filter by user"
            />
            <Input
              className="w-48"
              value={action}
              onChange={(e) => setUrl({ action: e.target.value, page: 1 })}
              placeholder="Action…"
              aria-label="Filter by action"
            />
            <SimpleSelect
              className="w-44"
              aria-label="Filter by cluster"
              value={clusterId}
              onValueChange={(v) => setUrl({ cluster: v, page: 1 })}
              options={[
                { label: 'All clusters', value: 'all' },
                ...(clusters.data ?? []).map((c) => ({ label: c.name, value: c.id })),
              ]}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="Actions such as creating a topic or resetting offsets will be recorded here."
          />
        }
      />
    </div>
  );
}

export default AuditPage;
