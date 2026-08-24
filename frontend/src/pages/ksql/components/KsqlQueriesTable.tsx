import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ListTree, Octagon } from 'lucide-react';
import { useTerminateKsqlQuery } from '@/api/hooks/ksql';
import type { KsqlQueryInfo } from '@/api/types';
import { truncate } from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

export interface KsqlQueriesTableProps {
  cluster: string;
  server: string;
  queries: KsqlQueryInfo[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onInspect?: (query: KsqlQueryInfo) => void;
}

/** Running persistent queries with a TERMINATE action. */
export function KsqlQueriesTable({
  cluster,
  server,
  queries,
  loading,
  error,
  onRetry,
  onInspect,
}: KsqlQueriesTableProps) {
  const terminate = useTerminateKsqlQuery(cluster, server);
  const [target, setTarget] = useState<KsqlQueryInfo | null>(null);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (queries ?? []).filter(
      (q) =>
        !term || q.id.toLowerCase().includes(term) || q.queryString.toLowerCase().includes(term),
    );
  }, [queries, search]);

  const columns = useMemo<ColumnDef<KsqlQueryInfo>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'Query id',
        meta: { label: 'Query id' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-[13px] font-medium">{row.original.id}</span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        meta: { label: 'State', widthClass: 'w-32' },
        cell: ({ row }) => <StatusPill status={row.original.state ?? 'unknown'} />,
      },
      {
        id: 'sinks',
        header: 'Sinks',
        meta: { label: 'Sinks' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {(row.original.sinks ?? []).map((sink) => (
              <Badge key={sink} variant="secondary" size="sm" className="font-mono">
                {sink}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'queryString',
        header: 'Statement',
        meta: { label: 'Statement' },
        cell: ({ row }) => (
          <Tooltip content={<span className="font-mono text-2xs">{row.original.queryString}</span>}>
            <span className="truncate font-mono text-2xs text-[var(--muted)]">
              {truncate(row.original.queryString.replace(/\s+/g, ' '), 90)}
            </span>
          </Tooltip>
        ),
      },
    ],
    [],
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
        searchPlaceholder="Search queries…"
        defaultSorting={[{ id: 'id', desc: false }]}
        onRowClick={onInspect}
        rowLabel="queries"
        rowActions={(query) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setTarget(query);
            }}
          >
            <Octagon /> Terminate
          </Button>
        )}
        emptyState={
          <EmptyState
            icon={ListTree}
            title={search ? 'No queries match your search' : 'No persistent queries'}
            description={
              search
                ? 'Try a different search term.'
                : 'CREATE STREAM/TABLE … AS SELECT starts a persistent query.'
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Terminate query"
        description={
          <>
            Stops persistent query <span className="font-mono">{target?.id}</span>. Its sink topics
            keep the data already written.
          </>
        }
        confirmLabel="Terminate"
        loading={terminate.isPending}
        onConfirm={async () => {
          if (!target) return;
          try {
            await terminate.mutateAsync(target.id);
            toast.success(`Query ${target.id} terminated`);
            setTarget(null);
            onRetry?.();
          } catch (e) {
            toastError('Failed to terminate query', e);
          }
        }}
      />
    </>
  );
}
