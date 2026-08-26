import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Crown, Server } from 'lucide-react';
import { useBrokers } from '@/api/hooks/brokers';
import type { Broker } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useSearchParamState } from '@/hooks/useUrlState';
import { formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { DiskUsageBar, diskPercent } from './DiskUsageBar';

export function BrokersPage() {
  const cluster = useClusterId();
  const [search, setSearch] = useSearchParamState<string>('q', '');
  const { data, isLoading, error, refetch } = useBrokers(cluster);

  const columns = useMemo<ColumnDef<Broker>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        meta: { numeric: true, label: 'ID', widthClass: 'w-20' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono tabular-nums">{row.original.id}</span>
            {row.original.isController ? <Crown className="size-3 text-[var(--warning)]" /> : null}
          </span>
        ),
      },
      {
        id: 'host',
        header: 'Host',
        meta: { label: 'Host' },
        accessorFn: (row) => `${row.host}:${row.port}`,
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">
            {row.original.host}:{row.original.port}
          </span>
        ),
      },
      {
        accessorKey: 'rack',
        header: 'Rack',
        meta: { label: 'Rack' },
        cell: ({ row }) =>
          row.original.rack ? (
            <Badge variant="secondary" size="sm">
              {row.original.rack}
            </Badge>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { label: 'Status', widthClass: 'w-28' },
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
      {
        accessorKey: 'partitionCount',
        header: 'Partitions',
        meta: { numeric: true, label: 'Partitions' },
        cell: ({ row }) => formatNumber(row.original.partitionCount),
      },
      {
        accessorKey: 'leaderCount',
        header: 'Leaders',
        meta: { numeric: true, label: 'Leaders' },
        cell: ({ row }) => formatNumber(row.original.leaderCount),
      },
      {
        accessorKey: 'underReplicatedPartitions',
        header: 'URP',
        meta: { numeric: true, label: 'URP' },
        cell: ({ row }) => (
          <span
            className={
              row.original.underReplicatedPartitions > 0 ? 'text-[var(--warning)]' : undefined
            }
          >
            {formatNumber(row.original.underReplicatedPartitions)}
          </span>
        ),
      },
      {
        id: 'disk',
        header: 'Disk',
        meta: { numeric: true, label: 'Disk', widthClass: 'w-40' },
        // Sort by % full when known, else by log size (so mixed clusters still order sensibly).
        accessorFn: (row) =>
          diskPercent(row.logDirTotalBytes, row.logDirUsableBytes) ?? row.logDirSizeBytes ?? -1,
        cell: ({ row }) => (
          <DiskUsageBar
            totalBytes={row.original.logDirTotalBytes}
            usableBytes={row.original.logDirUsableBytes}
            fallbackBytes={row.original.logDirSizeBytes}
          />
        ),
      },
      {
        accessorKey: 'version',
        header: 'Version',
        meta: { label: 'Version' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.version ?? '—'}</span>,
      },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (b) =>
        String(b.id).includes(q) ||
        b.host.toLowerCase().includes(q) ||
        (b.rack ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div>
      <PageHeader
        title="Brokers"
        description="Nodes in this Kafka cluster."
        meta={data ? <Badge variant="secondary">{data.length}</Badge> : null}
      />
      <DataTable
        columns={columns}
        data={filtered}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search brokers…"
        defaultSorting={[{ id: 'id', desc: false }]}
        getRowHref={(broker) => `/c/${cluster}/brokers/${broker.id}`}
        rowLabel="brokers"
        caption="Brokers in this cluster with status, partition counts and disk usage"
        emptyState={
          <EmptyState
            icon={Server}
            title="No brokers found"
            description="The cluster reported no brokers."
          />
        }
      />
    </div>
  );
}

export default BrokersPage;
