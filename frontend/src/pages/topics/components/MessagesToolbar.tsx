import { useMemo } from 'react';
import {
  ChevronDown,
  Crosshair,
  Download,
  Pause,
  Play,
  Radio,
  Send,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type { ExportFormat, MessageFormat, MessageMode, PartitionDetail } from '@/api/types';
import { formatCompact, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MultiCombobox } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DateTimeInput } from '@/components/ui/time-range-picker';
import { Tooltip } from '@/components/ui/tooltip';
import {
  advancedSummary,
  clampInt,
  FILTER_MODE_OPTIONS,
  FILTER_TARGET_OPTIONS,
  FORMAT_OPTIONS,
  LIMIT_OPTIONS,
  MODE_OPTIONS,
  type MessageQueryConfig,
} from './messageSearch';
import { TIMESTAMP_FORMAT_OPTIONS, type TimestampFormat } from './messageUtils';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function filterPlaceholder(config: MessageQueryConfig): string {
  if (config.filterMode === 'jsonpath') return '$.order.status';
  if (config.filterMode === 'regex') return 'ERROR|WARN  or  header:name=^v\\d+';
  if (config.filterTarget === 'header') return 'name=value  (or just name)';
  return 'Search key, value or headers…  (also header:name=value)';
}

export interface MessagesToolbarProps {
  config: MessageQueryConfig;
  patch: (partial: Partial<MessageQueryConfig>) => void;
  /** Typing in the search box also drops the "following key" scope. */
  onFilterChange: (value: string) => void;
  partitions: PartitionDetail[];
  scopedPartitions: PartitionDetail[];
  compacted: boolean;
  tombstoneCount: number;
  timestampFormat: TimestampFormat;
  onTimestampFormatChange: (value: TimestampFormat) => void;

  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;

  streaming: boolean;
  live: boolean;
  paused: boolean;
  pendingCount: number;
  onRun: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;

  followKey: string | null;
  onUnfollow: () => void;

  onExport: (format: ExportFormat) => void;
  exportPending: boolean;
  exportHint: string;
  onProduce: () => void;

  savedSearchesMenu?: React.ReactNode;
  fieldColumnsMenu?: React.ReactNode;
  statusStrip?: React.ReactNode;
}

/**
 * Query toolbar. The primary row carries what every session needs — the search, the read
 * position and the run / live controls. Encoding, partition scope, limit and filter
 * targeting live behind the Advanced disclosure, which badges any non-default value so
 * hidden configuration is never silent.
 */
export function MessagesToolbar({
  config,
  patch,
  onFilterChange,
  partitions,
  scopedPartitions,
  compacted,
  tombstoneCount,
  timestampFormat,
  onTimestampFormatChange,
  advancedOpen,
  onAdvancedOpenChange,
  streaming,
  live,
  paused,
  pendingCount,
  onRun,
  onPause,
  onResume,
  onStop,
  followKey,
  onUnfollow,
  onExport,
  exportPending,
  exportHint,
  onProduce,
  savedSearchesMenu,
  fieldColumnsMenu,
  statusStrip,
}: MessagesToolbarProps) {
  const isTail = config.mode === 'tail';
  const advanced = useMemo(() => advancedSummary(config), [config]);

  const offsetBounds = useMemo(() => {
    if (scopedPartitions.length === 0) return null;
    return {
      min: Math.min(...scopedPartitions.map((p) => p.beginOffset)),
      max: Math.max(...scopedPartitions.map((p) => p.endOffset)),
    };
  }, [scopedPartitions]);

  const scalarOffset = clampInt(config.offset, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const offsetOutOfRange =
    config.mode === 'offset' &&
    offsetBounds !== null &&
    (scalarOffset < offsetBounds.min || scalarOffset > offsetBounds.max);

  const partitionOptions = partitions.map((p) => ({
    label: `Partition ${p.id}`,
    value: String(p.id),
  }));

  const overrideCount =
    config.mode === 'offset'
      ? Object.values(config.perPartitionOffsets).filter((v) => v !== '').length
      : 0;

  const setOverride = (id: number, value: string) =>
    patch({ perPartitionOffsets: { ...config.perPartitionOffsets, [String(id)]: value } });

  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (!streaming) onRun();
        }
      }}
    >
      {/* ------------------------------ primary row ------------------------------ */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="msg-filter">Search</Label>
          <Input
            id="msg-filter"
            mono
            value={config.filter}
            onChange={(e) => onFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !streaming) onRun();
            }}
            placeholder={filterPlaceholder(config)}
            aria-describedby="msg-filter-hint"
          />
          <p id="msg-filter-hint" className="sr-only">
            Matching {config.filterMode} in{' '}
            {config.filterTarget === 'any' ? 'any field' : config.filterTarget}. Change how matching
            works under Advanced.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Read from</Label>
          <SimpleSelect
            className="w-[150px]"
            value={config.mode}
            onValueChange={(v) => patch({ mode: v as MessageMode })}
            options={MODE_OPTIONS}
            aria-label="Read position"
          />
        </div>

        {config.mode === 'offset' ? (
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
                value={config.offset}
                aria-invalid={offsetOutOfRange}
                onChange={(e) => patch({ offset: e.target.value })}
                onBlur={() => {
                  if (!offsetBounds) return;
                  const clamped = clampInt(config.offset, offsetBounds.min, offsetBounds.max);
                  if (clamped !== null) patch({ offset: String(clamped) });
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

        {config.mode === 'timestamp' ? (
          <div className="space-y-1.5">
            <Label>From time</Label>
            <DateTimeInput
              value={config.timestamp}
              onChange={(value) => patch({ timestamp: value })}
            />
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {streaming ? (
            <>
              {live ? (
                paused ? (
                  <Button variant="secondary" onClick={onResume}>
                    <Play /> Resume
                    {pendingCount > 0 ? (
                      <Badge variant="info" size="sm">
                        {formatCompact(pendingCount)} new
                      </Badge>
                    ) : null}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={onPause}>
                    <Pause /> Pause
                  </Button>
                )
              ) : null}
              <Button variant="destructive" onClick={onStop}>
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
              <Button onClick={onRun}>
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
                disabled={exportPending}
              >
                <Download />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal text-[var(--muted)]">
                {exportHint}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onExport('json')}>Export JSON</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('ndjson')}>Export NDJSON</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('csv')}>Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="secondary" onClick={onProduce}>
            <Send /> Produce
          </Button>
        </div>
      </div>

      {/* --------------------------- secondary controls -------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={advancedOpen}
          aria-controls="messages-advanced"
          aria-label={
            advanced.active
              ? `Advanced query options, ${advanced.count} non-default: ${advanced.items.join('; ')}`
              : 'Advanced query options'
          }
          onClick={() => onAdvancedOpenChange(!advancedOpen)}
        >
          <SlidersHorizontal /> Advanced
          {advanced.active ? (
            <Tooltip content={advanced.items.join(' · ')}>
              <Badge variant="info" size="sm">
                {advanced.count}
              </Badge>
            </Tooltip>
          ) : null}
          <ChevronDown className={cn('transition-transform', advancedOpen && 'rotate-180')} />
        </Button>

        {savedSearchesMenu}
        {fieldColumnsMenu}

        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden="true" />

        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span id="ts-format-label">Timestamps</span>
          <SimpleSelect
            className="h-7 w-[92px]"
            value={timestampFormat}
            onValueChange={(v) => onTimestampFormatChange(v as TimestampFormat)}
            options={TIMESTAMP_FORMAT_OPTIONS}
            aria-label="Timestamp format"
          />
        </div>

        {compacted ? (
          <label className="flex items-center gap-2 text-xs whitespace-nowrap text-[var(--muted)]">
            <Switch
              checked={config.hideTombstones}
              onCheckedChange={(checked) => patch({ hideTombstones: checked })}
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

        {followKey !== null ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] py-0.5 pr-1 pl-2 text-xs text-[var(--primary)]">
            <Crosshair className="size-3 shrink-0" />
            <span className="whitespace-nowrap">Following key</span>
            <span className="max-w-64 truncate font-mono" title={followKey}>
              {followKey}
            </span>
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
              aria-label="Stop following key"
              onClick={onUnfollow}
            >
              <X className="size-3" />
            </button>
          </span>
        ) : null}
      </div>

      {/* ----------------------------- advanced panel ---------------------------- */}
      {advancedOpen ? (
        <div
          id="messages-advanced"
          className="mt-3 space-y-3 rounded-[var(--radius-control)] border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Partitions</Label>
              <MultiCombobox
                className="w-[168px]"
                options={partitionOptions}
                values={config.partitions}
                onValuesChange={(values) => patch({ partitions: values })}
                placeholder="All partitions"
                summary={(v) => `${v.length} partition${v.length === 1 ? '' : 's'}`}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Limit</Label>
              <SimpleSelect
                className="w-[92px]"
                value={String(config.limit)}
                onValueChange={(v) => patch({ limit: Number(v) })}
                options={LIMIT_OPTIONS}
                aria-label="Maximum records"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Key encoding</Label>
              <SimpleSelect
                className="w-[120px]"
                value={config.keyFormat}
                onValueChange={(v) => patch({ keyFormat: v as MessageFormat })}
                options={FORMAT_OPTIONS}
                aria-label="Key encoding"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Value encoding</Label>
              <SimpleSelect
                className="w-[120px]"
                value={config.valueFormat}
                onValueChange={(v) => patch({ valueFormat: v as MessageFormat })}
                options={FORMAT_OPTIONS}
                aria-label="Value encoding"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Match mode</Label>
              <SimpleSelect
                className="w-[112px]"
                value={config.filterMode}
                onValueChange={(v) => patch({ filterMode: v as MessageQueryConfig['filterMode'] })}
                options={FILTER_MODE_OPTIONS}
                aria-label="Filter match mode"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Search in</Label>
              <Tooltip content="Where to match: key, value, headers, or anywhere">
                <span>
                  <SimpleSelect
                    className="w-[112px]"
                    value={config.filterTarget}
                    onValueChange={(v) =>
                      patch({ filterTarget: v as MessageQueryConfig['filterTarget'] })
                    }
                    options={FILTER_TARGET_OPTIONS}
                    aria-label="Filter target"
                  />
                </span>
              </Tooltip>
            </div>
          </div>

          {config.mode === 'offset' && scopedPartitions.length > 0 ? (
            <div className="space-y-2 border-t border-[var(--border)] pt-3">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Per-partition start offsets
                {overrideCount > 0 ? ` · ${overrideCount} overridden` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {scopedPartitions.map((p) => {
                  const raw = config.perPartitionOffsets[String(p.id)] ?? '';
                  const value =
                    raw === ''
                      ? scalarOffset
                      : (clampInt(raw, 0, Number.MAX_SAFE_INTEGER) ?? scalarOffset);
                  const outOfRange = value < p.beginOffset || value > p.endOffset;
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                    >
                      <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
                        Partition {p.id}
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
                        onChange={(e) => setOverride(p.id, e.target.value)}
                        onBlur={() => {
                          if (raw === '') return;
                          const clamped = clampInt(raw, p.beginOffset, p.endOffset);
                          setOverride(p.id, clamped === null ? '' : String(clamped));
                        }}
                      />
                      <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
                        {formatNumber(p.beginOffset)}–{formatNumber(p.endOffset)}
                      </span>
                    </label>
                  );
                })}
                {Object.keys(config.perPartitionOffsets).length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ perPartitionOffsets: {} })}
                  >
                    Reset to {formatNumber(scalarOffset)}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {statusStrip}
    </div>
  );
}
