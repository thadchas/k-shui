import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, Plus, Puzzle } from 'lucide-react';
import { useConnectPlugins } from '@/api/hooks/connect';
import type { ConnectorPlugin } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { useUrlState } from '@/hooks/useUrlState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { shortClass } from './components/connectUtils';

export function ConnectPluginsPage() {
  const cluster = useClusterId();
  const { kc: kcParam = '' } = useParams<{ kc: string }>();
  const kc = decodeURIComponent(kcParam);
  const navigate = useNavigate();
  const base = `/c/${cluster}/connect/${encodeURIComponent(kc)}`;

  const { canEdit } = usePermissions();
  const [{ q: search, type: typeFilter }, setUrl] = useUrlState({ q: '', type: 'all' });
  const setSearch = (q: string) => setUrl({ q });
  const setTypeFilter = (type: string) => setUrl({ type });

  const plugins = useConnectPlugins(cluster, kc);

  const rows = useMemo(() => {
    const list = plugins.data ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((plugin) => {
      if (typeFilter !== 'all' && plugin.type !== typeFilter) return false;
      if (!term) return true;
      return plugin.class.toLowerCase().includes(term);
    });
  }, [plugins.data, search, typeFilter]);

  const types = useMemo(
    () => Array.from(new Set((plugins.data ?? []).map((p) => p.type))).sort(),
    [plugins.data],
  );

  const columns = useMemo<ColumnDef<ConnectorPlugin>[]>(
    () => [
      {
        accessorKey: 'class',
        header: 'Plugin',
        meta: { label: 'Plugin' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium">
              {shortClass(row.original.class)}
            </span>
            <Tooltip content={<span className="font-mono">{row.original.class}</span>}>
              <span className="truncate font-mono text-2xs text-[var(--muted)]">
                {row.original.class}
              </span>
            </Tooltip>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        meta: { label: 'Type', widthClass: 'w-28' },
        cell: ({ row }) => (
          <Badge variant={row.original.type === 'source' ? 'accent' : 'info'} size="sm">
            {row.original.type}
          </Badge>
        ),
      },
      {
        accessorKey: 'version',
        header: 'Version',
        meta: { label: 'Version', widthClass: 'w-32' },
        cell: ({ row }) => (
          <span className="font-mono text-2xs">{row.original.version ?? '—'}</span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { widthClass: 'w-48', stopRowClick: true },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <CopyButton value={row.original.class} tooltip="Copy class name" />
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() =>
                    void navigate(
                      `${base}/connectors/new?plugin=${encodeURIComponent(row.original.class)}`,
                    )
                  }
                >
                  <Plus /> Use plugin
                </Button>
              </span>
            </Tooltip>
          </div>
        ),
      },
    ],
    [base, navigate, canEdit],
  );

  return (
    <div>
      <PageHeader
        title="Connector plugins"
        description={`Plugins installed on ${kc}.`}
        meta={plugins.data ? <Badge variant="secondary">{plugins.data.length}</Badge> : null}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={base}>
                <ArrowLeft /> Connectors
              </Link>
            </Button>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button asChild={canEdit} disabled={!canEdit}>
                  {canEdit ? (
                    <Link to={`${base}/connectors/new`}>
                      <Plus /> New connector
                    </Link>
                  ) : (
                    <>
                      <Plus /> New connector
                    </>
                  )}
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={plugins.isLoading}
        error={plugins.error}
        onRetry={() => void plugins.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search plugins…"
        defaultSorting={[{ id: 'class', desc: false }]}
        rowLabel="plugins"
        caption={`Connector plugins installed on ${kc}`}
        toolbar={
          <SimpleSelect
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={[
              { label: 'All types', value: 'all' },
              ...types.map((t) => ({ label: t, value: t })),
            ]}
            aria-label="Filter by plugin type"
            className="w-36"
          />
        }
        emptyState={
          <EmptyState
            icon={Puzzle}
            title={search ? 'No plugins match your search' : 'No plugins installed'}
            description={
              search
                ? 'Try a different search term.'
                : 'Install connector plugins on the Connect workers to see them here.'
            }
          />
        }
      />
    </div>
  );
}

export default ConnectPluginsPage;
