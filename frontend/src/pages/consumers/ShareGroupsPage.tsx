import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Share2 } from 'lucide-react';
import { useShareGroups } from '@/api/hooks/consumerGroups';
import type { ConsumerGroupSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { formatTimeLag } from './lag';

export function ShareGroupsPage() {
  const cluster = useClusterId();
  const [search, setSearch] = useState('');
  const { data, isLoading, error, refetch } = useShareGroups(cluster);

  const columns = useMemo<ColumnDef<ConsumerGroupSummary>[]>(
    () => [
      {
        accessorKey: 'groupId',
        header: 'Group',
        meta: { label: 'Group' },
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.groupId}</span>,
      },
      {
        accessorKey: 'state',
        header: 'State',
        meta: { label: 'State' },
        cell: ({ row }) => <StatusPill status={row.original.state} />,
      },
      { accessorKey: 'memberCount', header: 'Members', meta: { numeric: true, label: 'Members' } },
      { accessorKey: 'topicCount', header: 'Topics', meta: { numeric: true, label: 'Topics' } },
      {
        accessorKey: 'totalLag',
        header: 'Lag',
        meta: { numeric: true, label: 'Lag' },
        cell: ({ row }) => formatCompact(row.original.totalLag),
      },
      {
        accessorKey: 'maxTimeLagMs',
        header: 'Lag (time)',
        meta: { numeric: true, label: 'Lag (time)' },
        cell: ({ row }) => formatTimeLag(row.original.maxTimeLagMs),
      },
    ],
    [],
  );

  const unsupported = data && data.supported === false;

  return (
    <div>
      <PageHeader
        title="Share groups"
        description="Kafka 4.x queue-style share groups."
        meta={data?.items ? <Badge variant="secondary">{data.items.length}</Badge> : null}
      />

      {unsupported && !error ? (
        <Card>
          <EmptyState
            icon={Share2}
            title="Share groups not supported"
            description="This broker version does not expose share groups. They require Kafka 4.x with the feature enabled."
          />
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          searchPlaceholder="Search share groups…"
          defaultSorting={[{ id: 'totalLag', desc: true }]}
          rowLabel="share groups"
          emptyState={<EmptyState icon={Share2} title="No share groups" />}
        />
      )}
    </div>
  );
}

export default ShareGroupsPage;
