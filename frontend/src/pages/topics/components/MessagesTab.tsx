import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, MessageSquare, Play, Send, Square } from 'lucide-react';
import { useExportMessages, useMessageStream } from '@/api/hooks/messages';
import type {
  ExportFormat,
  FilterMode,
  Message,
  MessageFormat,
  MessageMode,
  MessagesQuery,
  PartitionDetail,
} from '@/api/types';
import { formatBytes, formatCompact, formatTimestamp, truncate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MultiCombobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { DateTimeInput } from '@/components/ui/time-range-picker';
import { toastError } from '@/components/ui/toast';
import { MessageDetailDrawer } from './MessageDetailDrawer';
import { ProduceMessageSheet } from './ProduceMessageSheet';

const MODE_OPTIONS: { label: string; value: MessageMode }[] = [
  { label: 'Latest', value: 'latest' },
  { label: 'Earliest', value: 'earliest' },
  { label: 'From offset', value: 'offset' },
  { label: 'From timestamp', value: 'timestamp' },
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

const LIMIT_OPTIONS = [50, 100, 250, 500, 1000].map((n) => ({
  label: String(n),
  value: String(n),
}));

function renderPreview(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface MessagesTabProps {
  cluster: string;
  topic: string;
  partitions: PartitionDetail[];
}

export function MessagesTab({ cluster, topic, partitions }: MessagesTabProps) {
  const [mode, setMode] = useState<MessageMode>('latest');
  const [selectedPartitions, setSelectedPartitions] = useState<string[]>([]);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState('0');
  const [timestamp, setTimestamp] = useState<number | null>(Date.now() - 3_600_000);
  const [keyFormat, setKeyFormat] = useState<MessageFormat>('auto');
  const [valueFormat, setValueFormat] = useState<MessageFormat>('auto');
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('contains');
  const [selected, setSelected] = useState<Message | null>(null);
  const [produceOpen, setProduceOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const stream = useMessageStream(cluster, topic);
  const exportMessages = useExportMessages(cluster, topic);

  const query = useMemo<MessagesQuery>(
    () => ({
      mode,
      partitions: selectedPartitions.length > 0 ? selectedPartitions.map(Number) : undefined,
      offset: mode === 'offset' ? Number(offset) : undefined,
      timestamp: mode === 'timestamp' && timestamp ? timestamp : undefined,
      limit,
      keyFormat,
      valueFormat,
      filter: filter || undefined,
      filterMode: filter ? filterMode : undefined,
    }),
    [
      mode,
      selectedPartitions,
      offset,
      timestamp,
      limit,
      keyFormat,
      valueFormat,
      filter,
      filterMode,
    ],
  );

  const run = () => {
    setHasRun(true);
    stream.start(query);
  };

  const doExport = async (format: ExportFormat) => {
    try {
      await exportMessages.mutateAsync({ format, query });
    } catch (e) {
      toastError('Export failed', e);
    }
  };

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
            {formatTimestamp(row.original.timestamp)}
          </span>
        ),
      },
      {
        id: 'key',
        header: 'Key',
        meta: { label: 'Key', widthClass: 'w-48' },
        cell: ({ row }) => (
          <span className="block max-w-48 truncate font-mono text-[13px]">
            {row.original.key === null || row.original.key === undefined ? (
              <span className="text-[var(--muted)]">null</span>
            ) : (
              renderPreview(row.original.key)
            )}
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        meta: { label: 'Value' },
        cell: ({ row }) => (
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
    [],
  );

  const partitionOptions = partitions.map((p) => ({
    label: `Partition ${p.id}`,
    value: String(p.id),
  }));
  const progressPct =
    stream.progress.scanned > 0
      ? Math.min(100, Math.round((stream.messages.length / Math.max(limit, 1)) * 100))
      : 0;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
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
              <Input
                id="from-offset"
                mono
                type="number"
                min={0}
                className="w-32"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
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
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') run();
                }}
                placeholder={
                  filterMode === 'jsonpath'
                    ? '$.order.status'
                    : filterMode === 'regex'
                      ? 'ERROR|WARN'
                      : 'substring…'
                }
              />
              <SimpleSelect
                className="w-[112px]"
                value={filterMode}
                onValueChange={(v) => setFilterMode(v as FilterMode)}
                options={FILTER_MODES}
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {stream.streaming ? (
              <Button variant="destructive" onClick={stream.stop}>
                <Square /> Stop
              </Button>
            ) : (
              <Button onClick={run}>
                <Play /> Fetch
              </Button>
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
              <DropdownMenuContent>
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

        {/* progress */}
        {hasRun ? (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-2xs text-[var(--muted)]">
              <span className="flex items-center gap-2">
                {stream.streaming ? (
                  <Badge variant="info">streaming</Badge>
                ) : (
                  <Badge variant="secondary">{stream.progress.done ? 'done' : 'idle'}</Badge>
                )}
                <span className="font-mono tabular-nums">
                  {formatCompact(stream.messages.length)} shown ·{' '}
                  {formatCompact(stream.progress.scanned)} scanned ·{' '}
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

      <DataTable
        columns={columns}
        data={stream.messages}
        loading={stream.streaming && stream.messages.length === 0}
        hideToolbar
        onRowClick={setSelected}
        maxHeight="60vh"
        rowLabel="messages"
        skeletonRows={10}
        emptyState={
          <EmptyState
            icon={MessageSquare}
            title={hasRun ? 'No messages matched' : 'Ready to browse'}
            description={
              hasRun
                ? 'Try a wider time window, a different mode, or clear the filter.'
                : 'Pick a mode and hit Fetch to stream records from this topic.'
            }
            action={
              !hasRun ? (
                <Button onClick={run}>
                  <Play /> Fetch messages
                </Button>
              ) : undefined
            }
          />
        }
      />

      <MessageDetailDrawer message={selected} onOpenChange={(open) => !open && setSelected(null)} />
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
