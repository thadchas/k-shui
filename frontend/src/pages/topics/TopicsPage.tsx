import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Copy,
  Eraser,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings2,
  SlidersHorizontal,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react';
import { useDeleteTopic, useTopics } from '@/api/hooks/topics';
import type { TopicSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { enumCodec, useUrlState } from '@/hooks/useUrlState';
import {
  formatBytesEstimate,
  formatBytesPerSec,
  formatCompact,
  formatDuration,
} from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { AddPartitionsDialog } from './components/AddPartitionsDialog';
import { CloneTopicDialog } from './components/CloneTopicDialog';
import { PurgeTopicDialog } from './components/PurgeTopicDialog';
import {
  BUILT_IN_TOPIC_VIEWS,
  columnWidth,
  createSavedView,
  defaultColumnPrefs,
  findBuiltInView,
  type TopicListFilters,
  getTopicHealth,
  HIDEABLE_TOPIC_COLUMNS,
  isColumnVisible,
  loadColumnPrefs,
  loadSavedViews,
  ORDERS,
  persistColumnPrefs,
  persistSavedViews,
  removeSavedView,
  sanitizeColumnPrefs,
  SORT_KEYS,
  TOPIC_COLUMNS,
  upsertSavedView,
  type SavedTopicView,
  type SortOrder,
  type TopicColumnPrefs,
  type TopicSortKey,
} from './topicViews';

const INTERNAL_LOCKED = 'Internal Kafka topic — open the topic page to change it deliberately.';

type SortKey = TopicSortKey;
type Order = SortOrder;

const URL_DEFAULTS = {
  q: '',
  page: 1,
  perPage: 50,
  sort: 'name' as SortKey,
  order: 'asc' as Order,
  showInternal: false,
};
const URL_CODECS = {
  sort: enumCodec(SORT_KEYS, 'name'),
  order: enumCodec(ORDERS, 'asc'),
};

/** Lookup by column id — built once, reused by header rendering. */
const COLUMN_META = new Map(TOPIC_COLUMNS.map((c) => [c.id, c] as const));

/**
 * The `name` and `health` columns are pinned (sticky) at fixed widths so the sticky-left
 * offset math stays correct; TOPIC_COLUMNS clamps their width to that same constant
 * (min === max === default), so this literal must stay in sync with `TOPIC_COLUMNS`.
 */
const NAME_COLUMN_WIDTH = 260;

type DialogState =
  | { kind: 'none' }
  | { kind: 'delete'; topic: TopicSummary }
  | { kind: 'purge'; topic: TopicSummary }
  | { kind: 'partitions'; topic: TopicSummary }
  | { kind: 'clone'; topic: TopicSummary };

export function TopicsPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();

  const { canEdit } = usePermissions();

  const [{ q: search, page, perPage, sort, order, showInternal }, setUrl] = useUrlState(
    URL_DEFAULTS,
    { codecs: URL_CODECS },
  );
  const debouncedSearch = useDebounced(search, 300);
  const sorting = useMemo<SortingState>(
    () => [{ id: sort, desc: order === 'desc' }],
    [sort, order],
  );
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  /* ---- saved views + column preferences (localStorage, scoped per cluster) ---- */
  const [columnPrefs, setColumnPrefs] = useState<TopicColumnPrefs>(() => loadColumnPrefs(cluster));
  const [savedViews, setSavedViews] = useState<SavedTopicView[]>(() => loadSavedViews(cluster));
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');

  // Views and column prefs are keyed per cluster; reload (and drop any stale selection)
  // whenever the operator switches clusters.
  useEffect(() => {
    setColumnPrefs(loadColumnPrefs(cluster));
    setSavedViews(loadSavedViews(cluster));
    setActiveViewId(null);
  }, [cluster]);

  useEffect(() => {
    persistColumnPrefs(cluster, columnPrefs);
  }, [cluster, columnPrefs]);

  const activeBuiltInView = useMemo(() => findBuiltInView(activeViewId), [activeViewId]);
  const activeSavedView = useMemo(
    () => savedViews.find((v) => v.id === activeViewId),
    [savedViews, activeViewId],
  );
  const activeViewLabel = activeBuiltInView?.name ?? activeSavedView?.name ?? null;

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      showInternal,
      page,
      perPage,
      sort,
      order,
    }),
    [debouncedSearch, showInternal, page, perPage, sort, order],
  );

  const { data, isLoading, error, refetch } = useTopics(cluster, query);

  const displayedTopics = useMemo(() => {
    const items = data?.items ?? [];
    return activeBuiltInView ? items.filter(activeBuiltInView.predicate) : items;
  }, [data, activeBuiltInView]);

  const activeTopic = dialog.kind !== 'none' ? dialog.topic : null;
  const deleteTopic = useDeleteTopic(cluster);

  const closeDialog = () => setDialog({ kind: 'none' });

  /* ------------------------------- view actions ------------------------------- */

  function applyBuiltInView(id: string) {
    const view = findBuiltInView(id);
    if (!view) return;
    setUrl({
      page: 1,
      ...(view.filters.sort ? { sort: view.filters.sort } : {}),
      ...(view.filters.order ? { order: view.filters.order } : {}),
      ...(view.filters.search !== undefined ? { q: view.filters.search } : {}),
      ...(view.filters.showInternal !== undefined
        ? { showInternal: view.filters.showInternal }
        : {}),
    });
    setActiveViewId(view.id);
  }

  function applySavedView(view: SavedTopicView) {
    setUrl({
      q: view.filters.search,
      showInternal: view.filters.showInternal,
      sort: view.filters.sort,
      order: view.filters.order,
      page: 1,
    });
    setColumnPrefs(view.columns);
    setActiveViewId(view.id);
  }

  function saveCurrentView(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const filters = { search, showInternal, sort, order };
    const existing = savedViews.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());
    const view = createSavedView(trimmed, filters, columnPrefs, existing?.id);
    const next = upsertSavedView(savedViews, view);
    persistSavedViews(cluster, next);
    setSavedViews(next);
    setActiveViewId(view.id);
  }

  /**
   * Filter/sort changes clear the active view only when they diverge from what
   * the view itself specifies — applying a view routes its own filters back
   * through these handlers, which must not deactivate the view it just set.
   */
  function clearViewUnlessMatches(changed: Partial<TopicListFilters>) {
    setActiveViewId((prev) => {
      if (!prev) return prev;
      const view = findBuiltInView(prev) ?? savedViews.find((v) => v.id === prev);
      if (!view) return null;
      for (const key of Object.keys(changed) as (keyof TopicListFilters)[]) {
        const expected = view.filters[key];
        if (expected !== undefined && expected !== changed[key]) return null;
      }
      return prev;
    });
  }

  function deleteSavedView(id: string) {
    setSavedViews((prev) => {
      const next = removeSavedView(prev, id);
      persistSavedViews(cluster, next);
      return next;
    });
    setActiveViewId((prev) => (prev === id ? null : prev));
  }

  function updateColumnVisibility(id: string, visible: boolean) {
    setColumnPrefs((prev) =>
      sanitizeColumnPrefs({ ...prev, visibility: { ...prev.visibility, [id]: visible } }),
    );
    setActiveViewId(null);
  }

  function updateColumnWidth(id: string, width: number) {
    setColumnPrefs((prev) =>
      sanitizeColumnPrefs({ ...prev, widths: { ...prev.widths, [id]: width } }),
    );
    setActiveViewId(null);
  }

  function resetColumnPrefs() {
    setColumnPrefs(defaultColumnPrefs());
    setActiveViewId(null);
  }

  /* --------------------------------- columns ---------------------------------- */

  const columns = useMemo<ColumnDef<TopicSummary>[]>(() => {
    const width = (id: string) => columnWidth(columnPrefs, id);
    const headerFor = (id: string) => {
      const meta = COLUMN_META.get(id);
      if (!meta) return id;
      return meta.shortLabel ? () => <span title={meta.label}>{meta.shortLabel}</span> : meta.label;
    };

    const defs: ColumnDef<TopicSummary>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: headerFor('name'),
        size: NAME_COLUMN_WIDTH,
        meta: {
          label: 'Topic name',
          widthClass: 'sticky left-0 z-[1] bg-[var(--surface)]',
        },
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={row.original.name}
              className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium"
            >
              {row.original.name}
            </span>
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
            <CopyButton value={row.original.name} tooltip="Copy topic name" className="shrink-0" />
          </div>
        ),
      },
      {
        id: 'health',
        header: headerFor('health'),
        size: width('health'),
        enableSorting: false,
        meta: {
          label: 'Health',
          widthClass:
            'sticky left-[260px] z-[1] border-r border-[var(--border)] bg-[var(--surface)]',
        },
        cell: ({ row }) => {
          const health = getTopicHealth(row.original);
          return health === 'unhealthy' ? (
            <StatusPill
              status="unhealthy"
              label={`Unhealthy (${row.original.underReplicatedPartitions} URP)`}
            />
          ) : (
            <StatusPill status="healthy" label="Healthy" />
          );
        },
      },
      {
        id: 'partitions',
        accessorKey: 'partitions',
        header: headerFor('partitions'),
        size: width('partitions'),
        meta: { numeric: true, label: 'Partitions' },
        cell: ({ row }) => row.original.partitions,
      },
      {
        id: 'replicationFactor',
        accessorKey: 'replicationFactor',
        header: headerFor('replicationFactor'),
        size: width('replicationFactor'),
        meta: { numeric: true, label: 'Replication factor' },
        cell: ({ row }) => row.original.replicationFactor,
      },
      {
        id: 'underReplicatedPartitions',
        accessorKey: 'underReplicatedPartitions',
        header: headerFor('underReplicatedPartitions'),
        size: width('underReplicatedPartitions'),
        meta: { numeric: true, label: 'Under-replicated partitions' },
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
        id: 'sizeBytes',
        accessorKey: 'sizeBytes',
        header: headerFor('sizeBytes'),
        size: width('sizeBytes'),
        meta: { numeric: true, label: 'Size' },
        cell: ({ row }) => (
          <span title="Estimated from the message count; Kafka exposes no exact topic log size.">
            {formatBytesEstimate(row.original.sizeBytes)}
          </span>
        ),
      },
      {
        id: 'messageCount',
        accessorKey: 'messageCount',
        header: headerFor('messageCount'),
        size: width('messageCount'),
        meta: { numeric: true, label: 'Messages' },
        cell: ({ row }) => formatCompact(row.original.messageCount),
      },
      {
        id: 'cleanupPolicy',
        accessorKey: 'cleanupPolicy',
        header: headerFor('cleanupPolicy'),
        size: width('cleanupPolicy'),
        meta: { label: 'Cleanup policy' },
        cell: ({ row }) => (
          <Badge variant="outline" size="sm">
            {row.original.cleanupPolicy}
          </Badge>
        ),
      },
      {
        id: 'retentionMs',
        accessorKey: 'retentionMs',
        header: headerFor('retentionMs'),
        size: width('retentionMs'),
        meta: { numeric: true, label: 'Retention' },
        cell: ({ row }) => formatDuration(row.original.retentionMs),
      },
      {
        id: 'bytesInPerSec',
        accessorKey: 'bytesInPerSec',
        header: headerFor('bytesInPerSec'),
        size: width('bytesInPerSec'),
        meta: { numeric: true, label: 'Bytes in/s' },
        cell: ({ row }) => formatBytesPerSec(row.original.bytesInPerSec),
      },
      {
        id: 'bytesOutPerSec',
        accessorKey: 'bytesOutPerSec',
        header: headerFor('bytesOutPerSec'),
        size: width('bytesOutPerSec'),
        meta: { numeric: true, label: 'Bytes out/s' },
        cell: ({ row }) => formatBytesPerSec(row.original.bytesOutPerSec),
      },
    ];

    return defs.filter((c) => isColumnVisible(columnPrefs, c.id as string));
  }, [columnPrefs]);

  const rowActions = (topic: TopicSummary) => {
    const locked = topic.isInternal;
    const lockedItem = (node: React.ReactElement) =>
      !canEdit ? (
        <Tooltip content={REQUIRES_EDITOR} side="left">
          <span className="block">{node}</span>
        </Tooltip>
      ) : locked ? (
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
          {lockedItem(
            <DropdownMenuItem
              disabled={!canEdit}
              onSelect={() =>
                void navigate(`/c/${cluster}/topics/${encodeURIComponent(topic.name)}?tab=configs`)
              }
            >
              <Settings2 /> Edit configs
            </DropdownMenuItem>,
          )}
          {lockedItem(
            <DropdownMenuItem
              disabled={locked || !canEdit}
              onSelect={() => setDialog({ kind: 'partitions', topic })}
            >
              <SplitSquareHorizontal /> Add partitions
            </DropdownMenuItem>,
          )}
          {lockedItem(
            <DropdownMenuItem
              disabled={!canEdit}
              onSelect={() => setDialog({ kind: 'clone', topic })}
            >
              <Copy /> Clone topic
            </DropdownMenuItem>,
          )}
          <DropdownMenuSeparator />
          {lockedItem(
            <DropdownMenuItem
              destructive
              disabled={locked || !canEdit}
              onSelect={() => setDialog({ kind: 'purge', topic })}
            >
              <Eraser /> Purge records
            </DropdownMenuItem>,
          )}
          {lockedItem(
            <DropdownMenuItem
              destructive
              disabled={locked || !canEdit}
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
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              {canEdit ? (
                <Button asChild>
                  <Link to={`/c/${cluster}/topics/new`}>
                    <Plus /> New topic
                  </Link>
                </Button>
              ) : (
                <Button disabled>
                  <Plus /> New topic
                </Button>
              )}
            </span>
          </Tooltip>
        }
      />

      {activeBuiltInView ? (
        <p className="mb-2 px-1 text-2xs text-[var(--muted)]">{activeBuiltInView.description}</p>
      ) : null}

      <DataTable
        columns={columns}
        data={displayedTopics}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        globalFilter={search}
        onGlobalFilterChange={(v) => {
          setUrl({ q: v, page: 1 });
          clearViewUnlessMatches({ search: v });
        }}
        searchPlaceholder="Search topics…"
        sorting={sorting}
        onSortingChange={(s) => {
          const next = s[0];
          const nextSort = (SORT_KEYS as readonly string[]).includes(next?.id ?? '')
            ? (next.id as SortKey)
            : 'name';
          setUrl({ sort: nextSort, order: next?.desc ? 'desc' : 'asc', page: 1 });
          clearViewUnlessMatches({ sort: nextSort, order: next?.desc ? 'desc' : 'asc' });
        }}
        manualSorting
        page={page}
        perPage={perPage}
        total={data?.total ?? 0}
        onPageChange={(p) => setUrl({ page: p })}
        onPerPageChange={(n) => setUrl({ perPage: n, page: 1 })}
        getRowHref={(topic) => `/c/${cluster}/topics/${encodeURIComponent(topic.name)}`}
        rowActions={rowActions}
        rowLabel="topics"
        caption="Topics in this cluster with health, partition count, replication, size and throughput"
        enableColumnVisibility={false}
        toolbar={
          <>
            <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--muted)]">
              <Switch
                checked={showInternal}
                onCheckedChange={(v) => {
                  setUrl({ showInternal: v, page: 1 });
                  clearViewUnlessMatches({ showInternal: v });
                }}
                aria-label="Show internal topics"
              />
              Show internal
            </label>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="md">
                  <Bookmark />
                  {activeViewLabel ? `View: ${activeViewLabel}` : 'Views'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Built-in views</DropdownMenuLabel>
                {BUILT_IN_TOPIC_VIEWS.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    onSelect={() => applyBuiltInView(v.id)}
                    className="flex flex-col items-start gap-0.5 whitespace-normal"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {activeViewId === v.id ? (
                        <Check className="size-3.5 text-[var(--primary)]" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      {v.name}
                    </span>
                    <span className="pl-5 text-2xs text-[var(--muted)]">{v.description}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedViews.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-[var(--muted)]">No saved views yet.</p>
                ) : (
                  savedViews.map((v) => (
                    <DropdownMenuItem
                      key={v.id}
                      className="flex items-center justify-between gap-1"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => applySavedView(v)}
                      >
                        {activeViewId === v.id ? (
                          <Check className="size-3.5 shrink-0 text-[var(--primary)]" />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        <span className="truncate">{v.name}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete saved view ${v.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSavedView(v.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover
              open={saveViewOpen}
              onOpenChange={(open) => {
                setSaveViewOpen(open);
                setSaveViewName(open ? (activeSavedView?.name ?? '') : '');
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="md">
                  <BookmarkPlus /> Save view
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveCurrentView(saveViewName);
                    setSaveViewOpen(false);
                  }}
                >
                  <label
                    htmlFor="topics-save-view-name"
                    className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]"
                  >
                    Save current filters, sort &amp; columns as
                  </label>
                  <Input
                    id="topics-save-view-name"
                    autoFocus
                    value={saveViewName}
                    onChange={(e) => setSaveViewName(e.target.value)}
                    placeholder="e.g. Compacted topics"
                  />
                  <Button type="submit" size="sm" disabled={!saveViewName.trim()}>
                    Save view
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          </>
        }
        toolbarExtra={
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="md">
                <SlidersHorizontal /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Visible columns &amp; width
              </p>
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {HIDEABLE_TOPIC_COLUMNS.map((col) => (
                  <div key={col.id} className="flex items-center gap-2 py-0.5">
                    <Checkbox
                      id={`topics-col-${col.id}`}
                      checked={isColumnVisible(columnPrefs, col.id)}
                      onCheckedChange={(v) => updateColumnVisibility(col.id, Boolean(v))}
                    />
                    <label
                      htmlFor={`topics-col-${col.id}`}
                      title={col.label}
                      className="min-w-0 flex-1 truncate text-sm"
                    >
                      {col.shortLabel ? `${col.shortLabel} — ${col.label}` : col.label}
                    </label>
                    <Input
                      type="number"
                      aria-label={`${col.label} column width in pixels`}
                      className="h-7 w-16 shrink-0 px-1.5 text-xs"
                      min={col.minWidth}
                      max={col.maxWidth}
                      step={10}
                      value={columnWidth(columnPrefs, col.id)}
                      onChange={(e) => updateColumnWidth(col.id, Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-end border-t border-[var(--border)] pt-2">
                <Button variant="ghost" size="sm" onClick={resetColumnPrefs}>
                  Reset to defaults
                </Button>
              </div>
            </PopoverContent>
          </Popover>
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
              !search && canEdit ? (
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
