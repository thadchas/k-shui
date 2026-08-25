import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowUp,
  Copy,
  Crosshair,
  Download,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  Send,
  Square,
  X,
} from 'lucide-react';
import { useExportMessages, useMessageStream } from '@/api/hooks/messages';
import type {
  ExportFormat,
  FilterMode,
  FilterTarget,
  Message,
  MessageFormat,
  MessageMode,
  MessagesQuery,
  PartitionDetail,
} from '@/api/types';
import { formatBytes, formatCompact, formatNumber, truncate } from '@/lib/format';
import { cn, downloadBlob } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MultiCombobox } from '@/components/ui/combobox';
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
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DateTimeInput } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { isCompacted } from './InternalTopicAck';
import { MessageDetailDrawer } from './MessageDetailDrawer';
import {
  exactKeyPattern,
  formatMessageTimestamp,
  isTombstone,
  keyFilterValue,
  readTimestampFormat,
  serializeMessages,
  stringifyField,
  TIMESTAMP_FORMAT_OPTIONS,
  type TimestampFormat,
  writeTimestampFormat,
} from './messageUtils';
import { ProduceMessageSheet } from './ProduceMessageSheet';

const MODE_OPTIONS: { label: string; value: MessageMode }[] = [
  { label: 'Latest', value: 'latest' },
  { label: 'Earliest', value: 'earliest' },
  { label: 'From offset', value: 'offset' },
  { label: 'From timestamp', value: 'timestamp' },
  { label: 'Live tail', value: 'tail' },
];

const FORMAT_OPTIONS: { label: string; value: MessageFormat }[] = [
  'auto',
  'string',
  'json',
  'avro',
  'protobuf',
  'jsonschema',
  'base64',
  'hex',
  'int',
  'long',
].map((f) => ({ label: f, value: f as MessageFormat }));

const FILTER_MODES: { label: string; value: FilterMode }[] = [
  { label: 'contains', value: 'contains' },
  { label: 'regex', value: 'regex' },
  { label: 'jsonpath', value: 'jsonpath' },
];

const FILTER_TARGETS: { label: string; value: FilterTarget }[] = [
  { label: 'anywhere', value: 'any' },
  { label: 'key', value: 'key' },
  { label: 'value', value: 'value' },
  { label: 'header', value: 'header' },
];

/** How far (px) the grid may be scrolled before we stop pinning it to the newest row. */
const AUTOSCROLL_THRESHOLD = 24;

const LIMIT_OPTIONS = [50, 100, 250, 500, 1000].map((n) => ({
  label: String(n),
  value: String(n),
}));

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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

function clampInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.trunc(n)));
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
  const [mode, setMode] = useState<MessageMode>('latest');
  const [selectedPartitions, setSelectedPartitions] = useState<string[]>([]);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState('0');
  const [perPartitionOffsets, setPerPartitionOffsets] = useState<Record<number, string>>({});
  const [showPerPartition, setShowPerPartition] = useState(false);
  const [timestamp, setTimestamp] = useState<number | null>(Date.now() - 3_600_000);
  const [keyFormat, setKeyFormat] = useState<MessageFormat>('auto');
  const [valueFormat, setValueFormat] = useState<MessageFormat>('auto');
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('contains');
  const [filterTarget, setFilterTarget] = useState<FilterTarget>('any');
  /** Exact key the browser is scoped to via the "Follow key" chip (null = free-form filter). */
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [hideTombstones, setHideTombstones] = useState(false);
  const [tsFormat, setTsFormat] = useState<TimestampFormat>(() => readTimestampFormat());
  const [selected, setSelected] = useState<Message | null>(null);
  const [produceOpen, setProduceOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const stream = useMessageStream(cluster, topic);
  const exportMessages = useExportMessages(cluster, topic);

  const compacted = isCompacted(cleanupPolicy);

  /* ----------------------------- partition scope ----------------------------- */

  const scopedPartitions = useMemo(() => {
    if (selectedPartitions.length === 0) return partitions;
    const wanted = new Set(selectedPartitions.map(Number));
    return partitions.filter((p) => wanted.has(p.id));
  }, [partitions, selectedPartitions]);

  const offsetBounds = useMemo(() => {
    if (scopedPartitions.length === 0) return null;
    return {
      min: Math.min(...scopedPartitions.map((p) => p.beginOffset)),
      max: Math.max(...scopedPartitions.map((p) => p.endOffset)),
    };
  }, [scopedPartitions]);

  const scalarOffset = clampInt(offset, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const offsetOutOfRange =
    mode === 'offset' &&
    offsetBounds !== null &&
    (scalarOffset < offsetBounds.min || scalarOffset > offsetBounds.max);

  const startOffsets = useMemo(() => {
    if (mode !== 'offset') return undefined;
    const out: { partition: number; offset: number }[] = [];
    for (const p of scopedPartitions) {
      const raw = perPartitionOffsets[p.id];
      if (raw === undefined || raw === '') continue;
      const value = clampInt(raw, 0, Number.MAX_SAFE_INTEGER);
      if (value !== null && value !== scalarOffset) out.push({ partition: p.id, offset: value });
    }
    return out.length > 0 ? out : undefined;
  }, [mode, scopedPartitions, perPartitionOffsets, scalarOffset]);

  /* --------------------------------- query --------------------------------- */

  const query = useMemo<MessagesQuery>(
    () => ({
      mode,
      partitions: selectedPartitions.length > 0 ? selectedPartitions.map(Number) : undefined,
      offset: mode === 'offset' ? scalarOffset : undefined,
      startOffsets,
      timestamp: mode === 'timestamp' && timestamp ? timestamp : undefined,
      limit,
      keyFormat,
      valueFormat,
      filter: filter || undefined,
      filterMode: filter ? filterMode : undefined,
      filterTarget: filter && filterTarget !== 'any' ? filterTarget : undefined,
    }),
    [
      mode,
      selectedPartitions,
      scalarOffset,
      startOffsets,
      timestamp,
      limit,
      keyFormat,
      valueFormat,
      filter,
      filterMode,
      filterTarget,
    ],
  );

  const queryRef = useRef(query);
  queryRef.current = query;

  const run = useCallback(() => {
    setHasRun(true);
    stream.start(queryRef.current);
  }, [stream]);

  const isTail = mode === 'tail';

  /* ------------------------------ follow key ------------------------------- */

  // Scope the filter to one exact key and re-run (a running tail restarts with the new filter).
  const follow = useCallback(
    (key: string) => {
      const pattern = exactKeyPattern(key);
      setFollowKey(key);
      setFilter(pattern);
      setFilterMode('regex');
      setFilterTarget('key');
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
    setFilter('');
    setFilterMode('contains');
    setFilterTarget('any');
    if (stream.live && stream.streaming) {
      stream.start({
        ...queryRef.current,
        filter: undefined,
        filterMode: undefined,
        filterTarget: undefined,
      });
    }
  }, [stream]);

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
    setSelectedPartitions([String(seek.partition)]);
    setHasRun(true);
    stream.start({ ...queryRef.current, partitions: [seek.partition] });
  }, [seek, stream]);

  /* ------------------------------- progress -------------------------------- */

  const estimatedTotal = useMemo(() => {
    const perPartitionShare = Math.max(
      1,
      Math.floor(limit / Math.max(scopedPartitions.length, 1)) + 1,
    );
    let total = 0;
    for (const p of scopedPartitions) {
      const size = Math.max(0, p.endOffset - p.beginOffset);
      if (mode === 'earliest') total += size;
      else if (mode === 'latest') total += Math.min(size, perPartitionShare);
      else if (mode === 'offset') {
        const override = startOffsets?.find((s) => s.partition === p.id)?.offset;
        const start = Math.min(p.endOffset, Math.max(p.beginOffset, override ?? scalarOffset));
        total += Math.max(0, p.endOffset - start);
      } else total += size; // timestamp: unknown until resolved — worst case whole partition
    }
    // Without a filter the server stops at `limit` matches, so the scan cannot exceed it.
    if (!filter) total = Math.min(total, limit);
    return total;
  }, [scopedPartitions, mode, limit, scalarOffset, startOffsets, filter]);

  const progressPct = stream.live
    ? 0
    : stream.progress.done
      ? 100
      : estimatedTotal > 0
        ? Math.min(99, Math.round((stream.progress.scanned / estimatedTotal) * 100))
        : stream.progress.scanned > 0
          ? 99
          : 0;

  /* -------------------------------- export --------------------------------- */

  const visibleMessages = useMemo(
    () =>
      hideTombstones && compacted
        ? stream.messages.filter((m) => !isTombstone(m))
        : stream.messages,
    [stream.messages, hideTombstones, compacted],
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

  const columns = useMemo<ColumnDef<Message>[]>(
    () => [
      {
        accessorKey: 'partition',
        header: 'P',
        meta: { numeric: true, label: 'Partition', widthClass: 'w-14' },
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
            <span className="block max-w-[520px] truncate font-mono text-[13px] text-[var(--muted)]">
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
        header: 'Hdrs',
        meta: { numeric: true, label: 'Headers', widthClass: 'w-16' },
        cell: ({ row }) => Object.keys(row.original.headers ?? {}).length,
      },
    ],
    [tsFormat, follow],
  );

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
          P{m.partition} · {m.offset}
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

  const partitionOptions = partitions.map((p) => ({
    label: `Partition ${p.id}`,
    value: String(p.id),
  }));

  const tombstoneCount = compacted ? stream.messages.filter(isTombstone).length : 0;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div
        className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!stream.streaming) run();
          }
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <SimpleSelect
              className="w-[150px]"
              value={mode}
              onValueChange={(v) => setMode(v as MessageMode)}
              options={MODE_OPTIONS}
            />
          </div>

          {mode === 'offset' ? (
            <div className="space-y-1.5">
              <Label htmlFor="from-offset">Offset</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="from-offset"
                  mono
                  type="number"
                  min={offsetBounds?.min ?? 0}
                  max={offsetBounds?.max}
                  className="w-32"
                  value={offset}
                  aria-invalid={offsetOutOfRange}
                  onChange={(e) => setOffset(e.target.value)}
                  onBlur={() => {
                    if (!offsetBounds) return;
                    const clamped = clampInt(offset, offsetBounds.min, offsetBounds.max);
                    if (clamped !== null) setOffset(String(clamped));
                  }}
                />
                {offsetBounds ? (
                  <Tooltip
                    content={
                      scopedPartitions.length === 1
                        ? `Partition ${scopedPartitions[0].id}: begin ${formatNumber(offsetBounds.min)}, end ${formatNumber(offsetBounds.max)}`
                        : `Across ${scopedPartitions.length} partitions: lowest begin ${formatNumber(offsetBounds.min)}, highest end ${formatNumber(offsetBounds.max)}`
                    }
                  >
                    <span
                      className={cn(
                        'font-mono text-2xs tabular-nums whitespace-nowrap',
                        offsetOutOfRange ? 'text-[var(--warning)]' : 'text-[var(--muted)]',
                      )}
                    >
                      {formatNumber(offsetBounds.min)} – {formatNumber(offsetBounds.max)}
                    </span>
                  </Tooltip>
                ) : null}
              </div>
            </div>
          ) : null}

          {mode === 'timestamp' ? (
            <div className="space-y-1.5">
              <Label>From time</Label>
              <DateTimeInput value={timestamp} onChange={setTimestamp} />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Partitions</Label>
            <MultiCombobox
              className="w-[168px]"
              options={partitionOptions}
              values={selectedPartitions}
              onValuesChange={setSelectedPartitions}
              placeholder="All partitions"
              summary={(v) => `${v.length} partition${v.length === 1 ? '' : 's'}`}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Limit</Label>
            <SimpleSelect
              className="w-[92px]"
              value={String(limit)}
              onValueChange={(v) => setLimit(Number(v))}
              options={LIMIT_OPTIONS}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Key format</Label>
            <SimpleSelect
              className="w-[120px]"
              value={keyFormat}
              onValueChange={(v) => setKeyFormat(v as MessageFormat)}
              options={FORMAT_OPTIONS}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Value format</Label>
            <SimpleSelect
              className="w-[120px]"
              value={valueFormat}
              onValueChange={(v) => setValueFormat(v as MessageFormat)}
              options={FORMAT_OPTIONS}
            />
          </div>

          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="msg-filter">Filter</Label>
            <div className="flex gap-2">
              <Input
                id="msg-filter"
                mono
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  if (followKey !== null) setFollowKey(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !stream.streaming) run();
                }}
                placeholder={
                  filterMode === 'jsonpath'
                    ? '$.order.status'
                    : filterMode === 'regex'
                      ? 'ERROR|WARN  or  header:name=^v\\d+'
                      : filterTarget === 'header'
                        ? 'name=value  (or just name)'
                        : 'substring…  or  header:name=value'
                }
              />
              <SimpleSelect
                className="w-[112px]"
                value={filterMode}
                onValueChange={(v) => setFilterMode(v as FilterMode)}
                options={FILTER_MODES}
              />
              <Tooltip content="Where to match: key, value, headers, or anywhere">
                <span>
                  <SimpleSelect
                    className="w-[112px]"
                    value={filterTarget}
                    onValueChange={(v) => setFilterTarget(v as FilterTarget)}
                    options={FILTER_TARGETS}
                    aria-label="Filter target"
                  />
                </span>
              </Tooltip>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {stream.streaming ? (
              <>
                {stream.live ? (
                  stream.paused ? (
                    <Button variant="secondary" onClick={stream.resume}>
                      <Play /> Resume
                      {stream.pendingCount > 0 ? (
                        <Badge variant="info" size="sm">
                          {formatCompact(stream.pendingCount)} new
                        </Badge>
                      ) : null}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={stream.pause}>
                      <Pause /> Pause
                    </Button>
                  )
                ) : null}
                <Button variant="destructive" onClick={stream.stop}>
                  <Square /> Stop
                </Button>
              </>
            ) : (
              <Tooltip
                content={
                  <span className="flex items-center gap-1">
                    {isTail ? 'Start tailing' : 'Fetch'} <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd>
                    <Kbd>↵</Kbd>
                  </span>
                }
              >
                <Button onClick={run}>
                  {isTail ? (
                    <>
                      <Radio /> Live tail
                    </>
                  ) : (
                    <>
                      <Play /> Fetch
                    </>
                  )}
                </Button>
              </Tooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Export messages"
                  disabled={exportMessages.isPending}
                >
                  <Download />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal text-[var(--muted)]">
                  {exportOnScreen
                    ? `${formatCompact(visibleMessages.length)} on-screen messages`
                    : 'Re-runs the query on the server'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void doExport('json')}>
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void doExport('ndjson')}>
                  Export NDJSON
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void doExport('csv')}>
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" onClick={() => setProduceOpen(true)}>
              <Send /> Produce
            </Button>
          </div>
        </div>

        {/* per-partition seek */}
        {mode === 'offset' && scopedPartitions.length > 0 ? (
          <div className="mt-3 space-y-2">
            <button
              type="button"
              className="text-2xs text-[var(--primary)] hover:underline"
              onClick={() => setShowPerPartition((v) => !v)}
            >
              {showPerPartition ? 'Hide' : 'Edit'} per-partition offsets
              {startOffsets ? ` (${startOffsets.length} overridden)` : ''}
            </button>
            {showPerPartition ? (
              <div className="flex flex-wrap gap-2">
                {scopedPartitions.map((p) => {
                  const raw = perPartitionOffsets[p.id] ?? '';
                  const value =
                    raw === ''
                      ? scalarOffset
                      : (clampInt(raw, 0, Number.MAX_SAFE_INTEGER) ?? scalarOffset);
                  const outOfRange = value < p.beginOffset || value > p.endOffset;
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] px-2 py-1"
                    >
                      <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
                        P{p.id}
                      </span>
                      <Input
                        mono
                        type="number"
                        min={p.beginOffset}
                        max={p.endOffset}
                        className="h-7 w-28 text-[13px]"
                        placeholder={String(scalarOffset)}
                        value={raw}
                        aria-invalid={raw !== '' && outOfRange}
                        aria-label={`Start offset for partition ${p.id}`}
                        onChange={(e) =>
                          setPerPartitionOffsets((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        onBlur={() => {
                          if (raw === '') return;
                          const clamped = clampInt(raw, p.beginOffset, p.endOffset);
                          setPerPartitionOffsets((prev) => ({
                            ...prev,
                            [p.id]: clamped === null ? '' : String(clamped),
                          }));
                        }}
                      />
                      <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
                        {formatNumber(p.beginOffset)}–{formatNumber(p.endOffset)}
                      </span>
                    </label>
                  );
                })}
                {Object.keys(perPartitionOffsets).length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setPerPartitionOffsets({})}>
                    Reset to {formatNumber(scalarOffset)}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* display options */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
          {followKey !== null ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] py-0.5 pr-1 pl-2 text-[var(--primary)]">
              <Crosshair className="size-3 shrink-0" />
              <span className="whitespace-nowrap">Following key</span>
              <span className="max-w-64 truncate font-mono" title={followKey}>
                {followKey}
              </span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
                aria-label="Stop following key"
                onClick={unfollow}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          <div className="flex items-center gap-2">
            <span>Timestamps</span>
            <SimpleSelect
              className="h-7 w-[92px]"
              value={tsFormat}
              onValueChange={(v) => changeTsFormat(v as TimestampFormat)}
              options={TIMESTAMP_FORMAT_OPTIONS}
            />
          </div>
          {compacted ? (
            <label className="flex items-center gap-2 whitespace-nowrap">
              <Switch
                checked={hideTombstones}
                onCheckedChange={setHideTombstones}
                aria-label="Hide tombstones"
              />
              Hide tombstones
              {tombstoneCount > 0 ? (
                <Badge variant="secondary" size="sm">
                  {formatCompact(tombstoneCount)}
                </Badge>
              ) : null}
            </label>
          ) : null}
        </div>

        {/* progress / live status */}
        {hasRun && stream.live ? (
          <div
            className="mt-4 flex flex-wrap items-center justify-between gap-2 text-2xs text-[var(--muted)]"
            role="status"
            aria-live="polite"
          >
            <span className="flex flex-wrap items-center gap-2">
              {stream.streaming ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide',
                    stream.paused
                      ? 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]'
                      : 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]',
                  )}
                >
                  <span className="relative flex size-2">
                    {!stream.paused ? (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
                    ) : null}
                    <span className="relative inline-flex size-2 rounded-full bg-current" />
                  </span>
                  {stream.paused ? 'paused' : 'live'}
                </span>
              ) : (
                <Badge variant="secondary">stopped</Badge>
              )}
              {stream.streaming ? (
                stream.behind > 0 ? (
                  <Badge variant="warning" size="sm">
                    {formatCompact(stream.behind)} behind
                  </Badge>
                ) : (
                  <Badge variant="success" size="sm">
                    caught up
                  </Badge>
                )
              ) : null}
              {stream.paused && stream.pendingCount > 0 ? (
                <Badge variant="info" size="sm">
                  {formatCompact(stream.pendingCount)} new while paused
                </Badge>
              ) : null}
              <span className="font-mono tabular-nums">
                {formatCompact(visibleMessages.length)} shown (last {formatCompact(limit)}) ·{' '}
                {formatCompact(stream.progress.scanned)} seen ·{' '}
                {formatCompact(stream.progress.matched)} matched
              </span>
            </span>
            <span>Newest first · following from the end of the topic</span>
          </div>
        ) : hasRun ? (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-2xs text-[var(--muted)]">
              <span className="flex items-center gap-2">
                {stream.streaming ? (
                  <Badge variant="info">streaming</Badge>
                ) : (
                  <Badge variant="secondary">{stream.progress.done ? 'done' : 'idle'}</Badge>
                )}
                <span className="font-mono tabular-nums">
                  {formatCompact(visibleMessages.length)} shown ·{' '}
                  {formatCompact(stream.progress.scanned)} scanned
                  {estimatedTotal > 0 ? ` of ~${formatCompact(estimatedTotal)}` : ''} ·{' '}
                  {formatCompact(stream.progress.matched)} matched
                </span>
              </span>
              <span className="font-mono tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className={cn(
                  'h-full rounded-full bg-[var(--primary)] transition-[width] duration-200',
                  stream.streaming && 'animate-pulse',
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

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
                    ? hideTombstones && stream.messages.length > 0
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
                    ? hideTombstones && stream.messages.length > 0
                      ? 'Turn off "Hide tombstones" to see them.'
                      : 'Try a wider time window, a different mode, or clear the filter.'
                    : isTail
                      ? 'Start a live tail to follow new records as they arrive.'
                      : 'Pick a mode and hit Fetch to stream records from this topic.'
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
      />
      <ProduceMessageSheet
        open={produceOpen}
        onOpenChange={setProduceOpen}
        cluster={cluster}
        topic={topic}
        partitions={partitions}
        onProduced={() => {
          if (mode === 'latest') run();
        }}
      />
    </div>
  );
}
