import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUp, Copy, Crosshair, MessageSquare, MoreHorizontal, Play, Radio } from 'lucide-react';
import { useExportMessages, useMessageStream } from '@/api/hooks/messages';
import type { ExportFormat, Message, PartitionDetail } from '@/api/types';
import { formatBytes, formatCompact, truncate } from '@/lib/format';
import { downloadBlob } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { InlineError } from '@/components/ui/error-state';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { isCompacted } from './InternalTopicAck';
import { FieldColumnsMenu } from './FieldColumnsMenu';
import { MessageDetailDrawer } from './MessageDetailDrawer';
import { MessageStreamStatus } from './MessageStreamStatus';
import { MessagesToolbar } from './MessagesToolbar';
import {
  buildMessagesQuery,
  clampInt,
  consumptionStatus,
  createSavedSearch,
  DEFAULT_QUERY_CONFIG,
  extractFieldValue,
  formatFieldValue,
  type MessageQueryConfig,
  readSavedSearches,
  type SavedSearch,
  suggestFieldPaths,
  writeSavedSearches,
} from './messageSearch';
import {
  exactKeyPattern,
  formatMessageTimestamp,
  isTombstone,
  keyFilterValue,
  readTimestampFormat,
  serializeMessages,
  stringifyField,
  type TimestampFormat,
  writeTimestampFormat,
} from './messageUtils';
import { ProduceMessageSheet } from './ProduceMessageSheet';
import { SavedSearchesMenu } from './SavedSearchesMenu';

/** How far (px) the grid may be scrolled before we stop pinning it to the newest row. */
const AUTOSCROLL_THRESHOLD = 24;

function renderPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch (e) {
    toastError(`Failed to copy ${label.toLowerCase()}`, e);
  }
}

/** Partitions the query actually reads: the selection, or every partition when unset. */
function scopePartitions(config: MessageQueryConfig, partitions: PartitionDetail[]) {
  if (config.partitions.length === 0) return partitions;
  const wanted = new Set(config.partitions.map(Number));
  return partitions.filter((p) => wanted.has(p.id));
}

/** External request to focus the browser on one partition (e.g. from the partitions table). */
export interface MessageSeek {
  partition: number;
  /** Bump to re-apply the same partition. */
  nonce: number;
}

export interface MessagesTabProps {
  cluster: string;
  topic: string;
  partitions: PartitionDetail[];
  cleanupPolicy?: string;
  seek?: MessageSeek | null;
}

export function MessagesTab({ cluster, topic, partitions, cleanupPolicy, seek }: MessagesTabProps) {
  const [config, setConfig] = useState<MessageQueryConfig>(() => ({
    ...DEFAULT_QUERY_CONFIG,
    timestamp: Date.now() - 3_600_000,
  }));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Exact key the browser is scoped to via the "Follow key" chip (null = free-form filter). */
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [tsFormat, setTsFormat] = useState<TimestampFormat>(() => readTimestampFormat());
  const [selected, setSelected] = useState<Message | null>(null);
  const [produceOpen, setProduceOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() =>
    readSavedSearches(cluster, topic),
  );
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const stream = useMessageStream(cluster, topic);
  const exportMessages = useExportMessages(cluster, topic);

  const compacted = isCompacted(cleanupPolicy);

  const configRef = useRef(config);
  configRef.current = config;

  /* ------------------------------ saved searches ---------------------------- */

  // Saved searches are scoped per cluster + topic; re-read when either changes.
  useEffect(() => {
    setSavedSearches(readSavedSearches(cluster, topic));
    setActiveSavedId(null);
  }, [cluster, topic]);

  const persistSearches = useCallback(
    (next: SavedSearch[]) => {
      setSavedSearches(next);
      writeSavedSearches(cluster, topic, next);
    },
    [cluster, topic],
  );

  /* ----------------------------- partition scope ----------------------------- */

  const scopedPartitions = useMemo(() => scopePartitions(config, partitions), [config, partitions]);

  /* --------------------------------- query --------------------------------- */

  const query = useMemo(
    () =>
      buildMessagesQuery(
        config,
        scopedPartitions.map((p) => p.id),
      ),
    [config, scopedPartitions],
  );

  const queryRef = useRef(query);
  queryRef.current = query;

  const patch = useCallback((partial: Partial<MessageQueryConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    setActiveSavedId(null);
  }, []);

  const run = useCallback(() => {
    setHasRun(true);
    stream.start(queryRef.current);
  }, [stream]);

  const isTail = config.mode === 'tail';

  const applySavedSearch = useCallback(
    (search: SavedSearch) => {
      const restored = search.config;
      setConfig(restored);
      setActiveSavedId(search.id);
      setFollowKey(null);
      setSelected(null);
      setHasRun(true);
      stream.start(
        buildMessagesQuery(
          restored,
          scopePartitions(restored, partitions).map((p) => p.id),
        ),
      );
      toast.success(`Restored "${search.name}"`);
    },
    [partitions, stream],
  );

  const saveSearch = useCallback(
    (name: string) => {
      const entry = createSavedSearch(name, configRef.current);
      persistSearches([entry, ...savedSearches.filter((s) => s.name !== entry.name)]);
      setActiveSavedId(entry.id);
      toast.success(`Saved "${entry.name}"`);
    },
    [persistSearches, savedSearches],
  );

  const deleteSearch = useCallback(
    (id: string) => {
      persistSearches(savedSearches.filter((s) => s.id !== id));
      setActiveSavedId((current) => (current === id ? null : current));
    },
    [persistSearches, savedSearches],
  );

  /* ------------------------------ follow key ------------------------------- */

  // Scope the filter to one exact key and re-run (a running tail restarts with the new filter).
  const follow = useCallback(
    (key: string) => {
      const pattern = exactKeyPattern(key);
      setFollowKey(key);
      setConfig((prev) => ({
        ...prev,
        filter: pattern,
        filterMode: 'regex',
        filterTarget: 'key',
      }));
      setActiveSavedId(null);
      setSelected(null);
      setHasRun(true);
      stream.start({
        ...queryRef.current,
        filter: pattern,
        filterMode: 'regex',
        filterTarget: 'key',
      });
    },
    [stream],
  );

  const unfollow = useCallback(() => {
    setFollowKey(null);
    setConfig((prev) => ({
      ...prev,
      filter: '',
      filterMode: 'contains',
      filterTarget: 'any',
    }));
    if (stream.live && stream.streaming) {
      stream.start({
        ...queryRef.current,
        filter: undefined,
        filterMode: undefined,
        filterTarget: undefined,
      });
    }
  }, [stream]);

  const changeFilter = useCallback(
    (value: string) => {
      patch({ filter: value });
      setFollowKey(null);
    },
    [patch],
  );

  /* ------------------------------ auto-scroll ------------------------------ */

  // Tail mode prepends rows; keep the grid pinned to the top unless the user scrolled away.
  const gridRef = useRef<HTMLDivElement>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  const scrollEl = () => gridRef.current?.querySelector<HTMLElement>('.overflow-auto') ?? null;

  useEffect(() => {
    if (!stream.live) {
      setScrolledAway(false);
      return;
    }
    const el = scrollEl();
    if (!el) return;
    const onScroll = () => setScrolledAway(el.scrollTop > AUTOSCROLL_THRESHOLD);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [stream.live, hasRun]);

  useEffect(() => {
    if (!stream.live || scrolledAway || stream.lastFlushAt === 0) return;
    const el = scrollEl();
    if (el && el.scrollTop > 0) el.scrollTop = 0;
  }, [stream.live, stream.lastFlushAt, scrolledAway]);

  const jumpToLatest = () => {
    const el = scrollEl();
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    setScrolledAway(false);
  };

  // Seek requests from outside (partition row click) select the partition and fetch.
  const lastSeek = useRef<number | null>(null);
  useEffect(() => {
    if (!seek || lastSeek.current === seek.nonce) return;
    lastSeek.current = seek.nonce;
    const next = { ...configRef.current, partitions: [String(seek.partition)] };
    setConfig(next);
    setActiveSavedId(null);
    setHasRun(true);
    stream.start(buildMessagesQuery(next, [seek.partition]));
  }, [seek, stream]);

  /* ------------------------------- progress -------------------------------- */

  const scalarOffset = clampInt(config.offset, 0, Number.MAX_SAFE_INTEGER) ?? 0;

  const estimatedTotal = useMemo(() => {
    const perPartitionShare = Math.max(
      1,
      Math.floor(config.limit / Math.max(scopedPartitions.length, 1)) + 1,
    );
    let total = 0;
    for (const p of scopedPartitions) {
      const size = Math.max(0, p.endOffset - p.beginOffset);
      if (config.mode === 'earliest') total += size;
      else if (config.mode === 'latest') total += Math.min(size, perPartitionShare);
      else if (config.mode === 'offset') {
        const override = query.startOffsets?.find((s) => s.partition === p.id)?.offset;
        const start = Math.min(p.endOffset, Math.max(p.beginOffset, override ?? scalarOffset));
        total += Math.max(0, p.endOffset - start);
      } else total += size; // timestamp: unknown until resolved — worst case whole partition
    }
    // Without a filter the server stops at `limit` matches, so the scan cannot exceed it.
    if (!config.filter) total = Math.min(total, config.limit);
    return total;
  }, [
    scopedPartitions,
    config.mode,
    config.limit,
    config.filter,
    scalarOffset,
    query.startOffsets,
  ]);

  const progressPct = stream.live
    ? 0
    : stream.progress.done
      ? 100
      : estimatedTotal > 0
        ? Math.min(99, Math.round((stream.progress.scanned / estimatedTotal) * 100))
        : stream.progress.scanned > 0
          ? 99
          : 0;

  const status = useMemo(
    () =>
      consumptionStatus({
        hasRun,
        streaming: stream.streaming,
        live: stream.live,
        paused: stream.paused,
        done: stream.progress.done,
      }),
    [hasRun, stream.streaming, stream.live, stream.paused, stream.progress.done],
  );

  /* -------------------------------- export --------------------------------- */

  const visibleMessages = useMemo(
    () =>
      config.hideTombstones && compacted
        ? stream.messages.filter((m) => !isTombstone(m))
        : stream.messages,
    [stream.messages, config.hideTombstones, compacted],
  );

  const exportOnScreen = (stream.progress.done || stream.live) && visibleMessages.length > 0;

  const doExport = async (format: ExportFormat) => {
    if (exportOnScreen) {
      const { blob, extension } = serializeMessages(visibleMessages, format);
      downloadBlob(blob, `${topic}-messages.${extension}`);
      toast.success(`Exported ${visibleMessages.length} on-screen messages`);
      return;
    }
    try {
      await exportMessages.mutateAsync({ format, query });
    } catch (e) {
      toastError('Export failed', e);
    }
  };

  const changeTsFormat = (v: TimestampFormat) => {
    setTsFormat(v);
    writeTimestampFormat(v);
  };

  /* -------------------------------- columns -------------------------------- */

  const fieldSuggestions = useMemo(() => suggestFieldPaths(stream.messages), [stream.messages]);

  const columns = useMemo<ColumnDef<Message>[]>(() => {
    const fieldColumns: ColumnDef<Message>[] = config.fieldColumns.map((path) => ({
      id: `field:${path}`,
      header: path,
      meta: { label: `Field: ${path}`, widthClass: 'w-40' },
      cell: ({ row }) => {
        const text = formatFieldValue(extractFieldValue(row.original.value, path));
        return (
          <span
            className="block max-w-40 truncate font-mono text-[13px]"
            title={text === '—' ? `${path} is not present in this record` : text}
          >
            {text}
          </span>
        );
      },
    }));

    return [
      {
        accessorKey: 'partition',
        header: 'Partition',
        meta: { numeric: true, label: 'Partition', widthClass: 'w-24' },
      },
      {
        accessorKey: 'offset',
        header: 'Offset',
        meta: { numeric: true, label: 'Offset', widthClass: 'w-28' },
      },
      {
        accessorKey: 'timestamp',
        header: 'Timestamp',
        meta: { label: 'Timestamp', widthClass: 'w-44' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums text-[var(--muted)]">
            {formatMessageTimestamp(row.original.timestamp, tsFormat)}
          </span>
        ),
      },
      {
        id: 'key',
        header: 'Key',
        meta: { label: 'Key', widthClass: 'w-48' },
        cell: ({ row }) =>
          row.original.key === null || row.original.key === undefined ? (
            <span className="text-[var(--muted)]" title="Record has no key">
              —
            </span>
          ) : (
            <Tooltip content="Follow this key (filter the browser to it)">
              <button
                type="button"
                className="block max-w-48 truncate rounded px-1 -mx-1 text-left font-mono text-[13px] hover:bg-[var(--surface-2)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                onClick={(e) => {
                  e.stopPropagation();
                  follow(keyFilterValue(row.original.key));
                }}
              >
                {renderPreview(row.original.key)}
              </button>
            </Tooltip>
          ),
      },
      ...fieldColumns,
      {
        id: 'value',
        header: 'Value',
        meta: { label: 'Value' },
        cell: ({ row }) =>
          isTombstone(row.original) ? (
            <Tooltip content="Null value for a keyed record — a compaction delete marker.">
              <Badge variant="warning" size="sm">
                tombstone
              </Badge>
            </Tooltip>
          ) : (
            <span
              className="block max-w-[520px] truncate font-mono text-[13px] text-[var(--muted)]"
              title={truncate(renderPreview(row.original.value), 2000)}
            >
              {truncate(renderPreview(row.original.value), 200)}
            </span>
          ),
      },
      {
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size', widthClass: 'w-24' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
      {
        id: 'headers',
        header: 'Headers',
        meta: { numeric: true, label: 'Headers', widthClass: 'w-24' },
        cell: ({ row }) => Object.keys(row.original.headers ?? {}).length,
      },
    ];
  }, [tsFormat, follow, config.fieldColumns]);

  const rowActions = (m: Message) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for offset ${m.offset}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>
          Partition {m.partition} · offset {m.offset}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={m.key === null || m.key === undefined}
          onSelect={() => void copyText('Key', m.keyRaw ?? stringifyField(m.key))}
        >
          <Copy /> Copy key
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={m.value === null || m.value === undefined}
          onSelect={() => void copyText('Value', m.valueRaw ?? stringifyField(m.value))}
        >
          <Copy /> Copy value
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText('Offset', String(m.offset))}>
          <Copy /> Copy offset
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={m.key === null || m.key === undefined}
          onSelect={() => follow(keyFilterValue(m.key))}
        >
          <Crosshair /> Follow key
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const tombstoneCount = compacted ? stream.messages.filter(isTombstone).length : 0;

  return (
    <div className="space-y-4">
      <MessagesToolbar
        config={config}
        patch={patch}
        onFilterChange={changeFilter}
        partitions={partitions}
        scopedPartitions={scopedPartitions}
        compacted={compacted}
        tombstoneCount={tombstoneCount}
        timestampFormat={tsFormat}
        onTimestampFormatChange={changeTsFormat}
        advancedOpen={advancedOpen}
        onAdvancedOpenChange={setAdvancedOpen}
        streaming={stream.streaming}
        live={stream.live}
        paused={stream.paused}
        pendingCount={stream.pendingCount}
        onRun={run}
        onPause={stream.pause}
        onResume={stream.resume}
        onStop={stream.stop}
        followKey={followKey}
        onUnfollow={unfollow}
        onExport={(format) => void doExport(format)}
        exportPending={exportMessages.isPending}
        exportHint={
          exportOnScreen
            ? `${formatCompact(visibleMessages.length)} on-screen messages`
            : 'Re-runs the query on the server'
        }
        onProduce={() => setProduceOpen(true)}
        savedSearchesMenu={
          <SavedSearchesMenu
            searches={savedSearches}
            activeId={activeSavedId}
            onSave={saveSearch}
            onApply={applySavedSearch}
            onDelete={deleteSearch}
          />
        }
        fieldColumnsMenu={
          <FieldColumnsMenu
            columns={config.fieldColumns}
            onChange={(fieldColumns) => patch({ fieldColumns })}
            suggestions={fieldSuggestions}
          />
        }
        statusStrip={
          <MessageStreamStatus
            status={status}
            behind={stream.behind}
            pendingCount={stream.pendingCount}
            shown={visibleMessages.length}
            scanned={stream.progress.scanned}
            matched={stream.progress.matched}
            limit={config.limit}
            estimatedTotal={estimatedTotal}
            progressPct={progressPct}
            live={stream.live}
          />
        }
      />

      {stream.error ? <InlineError error={stream.error} /> : null}

      <div ref={gridRef} className="relative">
        <DataTable
          columns={columns}
          data={visibleMessages}
          loading={stream.streaming && !stream.live && stream.messages.length === 0}
          hideToolbar
          onRowClick={setSelected}
          rowActions={rowActions}
          maxHeight="60vh"
          rowLabel="messages"
          skeletonRows={10}
          emptyState={
            <EmptyState
              icon={stream.live && stream.streaming ? Radio : MessageSquare}
              title={
                stream.live && stream.streaming
                  ? 'Waiting for new records…'
                  : hasRun
                    ? config.hideTombstones && stream.messages.length > 0
                      ? 'Only tombstones matched'
                      : 'No messages matched'
                    : 'Ready to browse'
              }
              description={
                stream.live && stream.streaming
                  ? followKey !== null
                    ? `Records with key ${followKey} will appear here as they are produced.`
                    : 'New records will appear here as they are produced to the topic.'
                  : hasRun
                    ? config.hideTombstones && stream.messages.length > 0
                      ? 'Turn off "Hide tombstones" to see them.'
                      : 'Try a wider time window, a different mode, or clear the search.'
                    : isTail
                      ? 'Start a live tail to follow new records as they arrive.'
                      : 'Pick a read position and hit Fetch to stream records from this topic.'
              }
              action={
                !hasRun ? (
                  <Button onClick={run}>
                    {isTail ? (
                      <>
                        <Radio /> Start live tail
                      </>
                    ) : (
                      <>
                        <Play /> Fetch messages
                      </>
                    )}
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {stream.live && stream.streaming && scrolledAway ? (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex justify-center">
            <Button
              size="sm"
              className="pointer-events-auto shadow-[var(--shadow-lg)]"
              onClick={jumpToLatest}
            >
              <ArrowUp /> Jump to latest
            </Button>
          </div>
        ) : null}
      </div>

      <MessageDetailDrawer
        message={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        timestampFormat={tsFormat}
        onFollowKey={follow}
        fieldColumns={config.fieldColumns}
        onAddFieldColumn={(path) =>
          patch({
            fieldColumns: config.fieldColumns.includes(path)
              ? config.fieldColumns
              : [...config.fieldColumns, path],
          })
        }
      />
      <ProduceMessageSheet
        open={produceOpen}
        onOpenChange={setProduceOpen}
        cluster={cluster}
        topic={topic}
        partitions={partitions}
        onProduced={() => {
          if (config.mode === 'latest') run();
        }}
      />
    </div>
  );
}
