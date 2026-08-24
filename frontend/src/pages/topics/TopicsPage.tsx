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
import {
  useAddPartitions,
  useCloneTopic,
  useDeleteTopic,
  usePurgeTopic,
  useTopics,
} from '@/api/hooks/topics';
import type { TopicSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { formatBytes, formatBytesPerSec, formatCompact, formatDuration } from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

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
  const [partitionCount, setPartitionCount] = useState(1);
  const [cloneName, setCloneName] = useState('');

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
  const purgeTopic = usePurgeTopic(cluster, activeTopic?.name ?? '');
  const addPartitions = useAddPartitions(cluster, activeTopic?.name ?? '');
  const cloneTopic = useCloneTopic(cluster, activeTopic?.name ?? '');

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
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
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

  const rowActions = (topic: TopicSummary) => (
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
        <DropdownMenuItem
          onSelect={() => {
            setPartitionCount(topic.partitions + 1);
            setDialog({ kind: 'partitions', topic });
          }}
        >
          <SplitSquareHorizontal /> Add partitions
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setCloneName(`${topic.name}-copy`);
            setDialog({ kind: 'clone', topic });
          }}
        >
          <Copy /> Clone topic
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => setDialog({ kind: 'purge', topic })}>
          <Eraser /> Purge records
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => setDialog({ kind: 'delete', topic })}>
          <Trash2 /> Delete topic
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
      <ConfirmDestructiveDialog
        open={dialog.kind === 'purge'}
        onOpenChange={(open) => !open && closeDialog()}
        title="Purge all records"
        description={
          <>
            Deletes every record in <span className="font-mono">{activeTopic?.name}</span> by
            advancing the start offsets to the end. The topic itself is kept.
          </>
        }
        confirmText={activeTopic?.name}
        confirmLabel="Purge records"
        loading={purgeTopic.isPending}
        onConfirm={async () => {
          if (!activeTopic) return;
          try {
            await purgeTopic.mutateAsync(undefined);
            toast.success(`Purged ${activeTopic.name}`);
            closeDialog();
          } catch (e) {
            toastError('Failed to purge topic', e);
          }
        }}
      />

      {/* add partitions */}
      <Dialog open={dialog.kind === 'partitions'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add partitions</DialogTitle>
            <DialogDescription>
              Partition count can only increase. Increasing partitions changes key-to-partition
              mapping for new records.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="partition-count">New partition count</Label>
            <Input
              id="partition-count"
              type="number"
              min={(activeTopic?.partitions ?? 0) + 1}
              value={partitionCount}
              onChange={(e) => setPartitionCount(Number(e.target.value))}
            />
            <p className="text-2xs text-[var(--muted)]">
              Currently {activeTopic?.partitions} partitions.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              loading={addPartitions.isPending}
              disabled={partitionCount <= (activeTopic?.partitions ?? 0)}
              onClick={async () => {
                try {
                  await addPartitions.mutateAsync({ count: partitionCount });
                  toast.success('Partitions added');
                  closeDialog();
                } catch (e) {
                  toastError('Failed to add partitions', e);
                }
              }}
            >
              Add partitions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* clone */}
      <Dialog open={dialog.kind === 'clone'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Clone topic</DialogTitle>
            <DialogDescription>
              Creates a new topic with the same partition count, replication factor and configs.
              Records are not copied.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="clone-name">New topic name</Label>
            <Input
              id="clone-name"
              mono
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              loading={cloneTopic.isPending}
              disabled={!cloneName.trim()}
              onClick={async () => {
                try {
                  await cloneTopic.mutateAsync({ name: cloneName.trim() });
                  toast.success(`Cloned to ${cloneName.trim()}`);
                  closeDialog();
                } catch (e) {
                  toastError('Failed to clone topic', e);
                }
              }}
            >
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TopicsPage;
