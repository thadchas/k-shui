import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  Copy,
  Eraser,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings2,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react';
import { useDeleteTopic, useTopics } from '@/api/hooks/topics';
import type { TopicSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import {
  formatBytesEstimate,
  formatBytesPerSec,
  formatCompact,
  formatDuration,
} from '@/lib/format';
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
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { AddPartitionsDialog } from './components/AddPartitionsDialog';
import { CloneTopicDialog } from './components/CloneTopicDialog';
import { PurgeTopicDialog } from './components/PurgeTopicDialog';

const INTERNAL_LOCKED = 'Internal Kafka topic — open the topic page to change it deliberately.';

type DialogState =
  | { kind: 'none' }
  | { kind: 'delete'; topic: TopicSummary }
  | { kind: 'purge'; topic: TopicSummary }
  | { kind: 'partitions'; topic: TopicSummary }
  | { kind: 'clone'; topic: TopicSummary };

export function TopicsPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [showInternal, setShowInternal] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      showInternal,
      page,
      perPage,
      sort: sorting[0]?.id,
      order: (sorting[0]?.desc ? 'desc' : 'asc') as 'asc' | 'desc',
    }),
    [debouncedSearch, showInternal, page, perPage, sorting],
  );

  const { data, isLoading, error, refetch } = useTopics(cluster, query);

  const activeTopic = dialog.kind !== 'none' ? dialog.topic : null;
  const deleteTopic = useDeleteTopic(cluster);

  const closeDialog = () => setDialog({ kind: 'none' });

  const columns = useMemo<ColumnDef<TopicSummary>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Topic',
        meta: { label: 'Topic' },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium">{row.original.name}</span>
            {row.original.isInternal ? (
              <Badge variant="secondary" size="sm">
                internal
              </Badge>
            ) : null}
            {row.original.hasSchema?.key ? (
              <Tooltip content="Key schema registered">
                <Badge variant="accent" size="sm">
                  K
                </Badge>
              </Tooltip>
            ) : null}
            {row.original.hasSchema?.value ? (
              <Tooltip content="Value schema registered">
                <Badge variant="accent" size="sm">
                  V
                </Badge>
              </Tooltip>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'partitions',
        header: 'Parts',
        meta: { numeric: true, label: 'Partitions' },
        cell: ({ row }) => row.original.partitions,
      },
      {
        accessorKey: 'replicationFactor',
        header: 'RF',
        meta: { numeric: true, label: 'Replication factor' },
        cell: ({ row }) => row.original.replicationFactor,
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
            {row.original.underReplicatedPartitions}
          </span>
        ),
      },
      {
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size' },
        cell: ({ row }) => (
          <span title="Estimated from the message count; Kafka exposes no exact topic log size.">
            {formatBytesEstimate(row.original.sizeBytes)}
          </span>
        ),
      },
      {
        accessorKey: 'messageCount',
        header: 'Messages',
        meta: { numeric: true, label: 'Messages' },
        cell: ({ row }) => formatCompact(row.original.messageCount),
      },
      {
        accessorKey: 'cleanupPolicy',
        header: 'Cleanup',
        meta: { label: 'Cleanup policy' },
        cell: ({ row }) => (
          <Badge variant="outline" size="sm">
            {row.original.cleanupPolicy}
          </Badge>
        ),
      },
      {
        accessorKey: 'retentionMs',
        header: 'Retention',
        meta: { numeric: true, label: 'Retention' },
        cell: ({ row }) => formatDuration(row.original.retentionMs),
      },
      {
        accessorKey: 'bytesInPerSec',
        header: 'In',
        meta: { numeric: true, label: 'Bytes in/s' },
        cell: ({ row }) => formatBytesPerSec(row.original.bytesInPerSec),
      },
      {
        accessorKey: 'bytesOutPerSec',
        header: 'Out',
        meta: { numeric: true, label: 'Bytes out/s' },
        cell: ({ row }) => formatBytesPerSec(row.original.bytesOutPerSec),
      },
    ],
    [],
  );

  const rowActions = (topic: TopicSummary) => {
    const locked = topic.isInternal;
    const lockedItem = (node: React.ReactElement) =>
      locked ? (
        <Tooltip content={INTERNAL_LOCKED} side="left">
          <span className="block">{node}</span>
        </Tooltip>
      ) : (
        node
      );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${topic.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() =>
              void navigate(`/c/${cluster}/topics/${encodeURIComponent(topic.name)}?tab=messages`)
            }
          >
            <MessageSquare /> Browse messages
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void navigate(`/c/${cluster}/topics/${encodeURIComponent(topic.name)}?tab=configs`)
            }
          >
            <Settings2 /> Edit configs
          </DropdownMenuItem>
          {lockedItem(
            <DropdownMenuItem
              disabled={locked}
              onSelect={() => setDialog({ kind: 'partitions', topic })}
            >
              <SplitSquareHorizontal /> Add partitions
            </DropdownMenuItem>,
          )}
          <DropdownMenuItem onSelect={() => setDialog({ kind: 'clone', topic })}>
            <Copy /> Clone topic
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {lockedItem(
            <DropdownMenuItem
              destructive
              disabled={locked}
              onSelect={() => setDialog({ kind: 'purge', topic })}
            >
              <Eraser /> Purge records
            </DropdownMenuItem>,
          )}
          {lockedItem(
            <DropdownMenuItem
              destructive
              disabled={locked}
              onSelect={() => setDialog({ kind: 'delete', topic })}
            >
              <Trash2 /> Delete topic
            </DropdownMenuItem>,
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div>
      <PageHeader
        title="Topics"
        description="Browse, inspect and manage topics in this cluster."
        meta={data ? <Badge variant="secondary">{formatCompact(data.total)}</Badge> : null}
        actions={
          <Button asChild>
            <Link to={`/c/${cluster}/topics/new`}>
              <Plus /> New topic
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search topics…"
        sorting={sorting}
        onSortingChange={(s) => {
          setSorting(s.length ? s : [{ id: 'name', desc: false }]);
          setPage(1);
        }}
        manualSorting
        page={page}
        perPage={perPage}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
        onRowClick={(topic) =>
          void navigate(`/c/${cluster}/topics/${encodeURIComponent(topic.name)}`)
        }
        rowActions={rowActions}
        rowLabel="topics"
        toolbar={
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--muted)]">
            <Switch
              checked={showInternal}
              onCheckedChange={(v) => {
                setShowInternal(v);
                setPage(1);
              }}
              aria-label="Show internal topics"
            />
            Show internal
          </label>
        }
        emptyState={
          <EmptyState
            icon={Layers}
            title={search ? 'No topics match your search' : 'No topics yet'}
            description={
              search
                ? 'Try a different search term.'
                : 'Create your first topic to start streaming.'
            }
            action={
              !search ? (
                <Button asChild>
                  <Link to={`/c/${cluster}/topics/new`}>
                    <Plus /> New topic
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      />

      {/* delete */}
      <ConfirmDestructiveDialog
        open={dialog.kind === 'delete'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Delete topic"
        description={
          <>
            This permanently removes <span className="font-mono">{activeTopic?.name}</span> and all
            of its data. This cannot be undone.
          </>
        }
        confirmText={activeTopic?.name}
        confirmLabel="Delete topic"
        loading={deleteTopic.isPending}
        onConfirm={async () => {
          if (!activeTopic) return;
          try {
            await deleteTopic.mutateAsync(activeTopic.name);
            toast.success(`Topic ${activeTopic.name} deleted`);
            closeDialog();
          } catch (e) {
            toastError('Failed to delete topic', e);
          }
        }}
      />

      {/* purge */}
      <PurgeTopicDialog
        open={dialog.kind === 'purge'}
        onOpenChange={(open) => !open && closeDialog()}
        cluster={cluster}
        topic={activeTopic}
      />

      {/* add partitions */}
      <AddPartitionsDialog
        open={dialog.kind === 'partitions'}
        onOpenChange={(open) => !open && closeDialog()}
        cluster={cluster}
        topic={activeTopic}
      />

      {/* clone */}
      <CloneTopicDialog
        open={dialog.kind === 'clone'}
        onOpenChange={(open) => !open && closeDialog()}
        cluster={cluster}
        topic={activeTopic?.name ?? null}
      />
    </div>
  );
}

export default TopicsPage;
