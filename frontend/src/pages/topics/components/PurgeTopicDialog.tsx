import { useEffect, useMemo, useState } from 'react';
import { usePurgeTopic, useTopic } from '@/api/hooks/topics';
import type { PartitionDetail, PurgeTopicRequest } from '@/api/types';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { toast, toastError } from '@/components/ui/toast';
import { InternalTopicAck } from './InternalTopicAck';

type PurgeMode = 'all' | 'partitions';

export interface PurgeTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: string;
  topic: { name: string; isInternal: boolean } | null;
  /** Pass when the caller already has partition detail; otherwise it is fetched on open. */
  partitions?: PartitionDetail[];
  requireInternalAck?: boolean;
  onPurged?: () => void;
}

interface RowState {
  selected: boolean;
  offset: string;
}

function parseOffset(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function PurgeTopicDialog({
  open,
  onOpenChange,
  cluster,
  topic,
  partitions: givenPartitions,
  requireInternalAck = false,
  onPurged,
}: PurgeTopicDialogProps) {
  const name = topic?.name ?? '';
  const [mode, setMode] = useState<PurgeMode>('all');
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [ack, setAck] = useState(false);

  const shouldFetch = open && !givenPartitions && Boolean(name);
  const detail = useTopic(shouldFetch ? cluster : undefined, shouldFetch ? name : undefined);
  const fetchedPartitions = detail.data?.partitionsDetail;
  const partitions = useMemo(
    () => givenPartitions ?? fetchedPartitions ?? [],
    [givenPartitions, fetchedPartitions],
  );
  const loadingPartitions = shouldFetch && detail.isLoading;

  const purgeTopic = usePurgeTopic(cluster, name);

  useEffect(() => {
    if (open) {
      setMode('all');
      setAck(false);
      setRows({});
    }
  }, [open]);

  // Prefill each partition with its end offset once detail arrives.
  useEffect(() => {
    if (!open || partitions.length === 0) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const p of partitions) {
        if (!next[p.id]) next[p.id] = { selected: false, offset: String(p.endOffset) };
      }
      return next;
    });
  }, [open, partitions]);

  const selectedRows = useMemo(
    () =>
      partitions
        .filter((p) => rows[p.id]?.selected)
        .map((p) => ({ partition: p, offset: parseOffset(rows[p.id]?.offset ?? '') })),
    [partitions, rows],
  );

  const invalidRows = selectedRows.filter(
    ({ partition, offset }) => offset === null || offset < 0 || offset > partition.endOffset,
  );

  const needsAck = requireInternalAck && Boolean(topic?.isInternal);
  const partitionsValid = mode === 'all' || (selectedRows.length > 0 && invalidRows.length === 0);
  const canSubmit = partitionsValid && (!needsAck || ack);

  const setRow = (id: number, patch: Partial<RowState>) =>
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { selected: false, offset: '' }), ...patch },
    }));

  const allSelected = partitions.length > 0 && partitions.every((p) => rows[p.id]?.selected);

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'all' ? 'Purge all records' : 'Purge records from partitions'}
      description={
        mode === 'all' ? (
          <>
            Deletes every record in <span className="font-mono">{name}</span> by advancing each
            partition&apos;s start offset to its end. The topic itself is kept.
          </>
        ) : (
          <>
            Deletes records in the selected partitions of <span className="font-mono">{name}</span>{' '}
            with an offset lower than the one you enter. The topic itself is kept.
          </>
        )
      }
      confirmText={name || undefined}
      confirmLabel="Purge records"
      loading={purgeTopic.isPending}
      onConfirm={async () => {
        if (!topic || !canSubmit) return;
        const body: PurgeTopicRequest =
          mode === 'all'
            ? {}
            : {
                partitions: selectedRows.map(({ partition, offset }) => ({
                  id: partition.id,
                  beforeOffset: offset ?? partition.endOffset,
                })),
              };
        try {
          await purgeTopic.mutateAsync(body);
          toast.success(
            mode === 'all'
              ? `Purged ${name}`
              : `Purged ${selectedRows.length} partition${selectedRows.length === 1 ? '' : 's'} of ${name}`,
          );
          onOpenChange(false);
          onPurged?.();
        } catch (e) {
          toastError('Failed to purge topic', e);
        }
      }}
    >
      <RadioGroup
        value={mode}
        onValueChange={(v) => setMode(v as PurgeMode)}
        className="grid grid-cols-2 gap-2"
        aria-label="Purge scope"
      >
        {(
          [
            ['all', 'Entire topic'],
            ['partitions', 'Specific partitions'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm',
              mode === value
                ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]'
                : 'border-[var(--border)]',
            )}
          >
            <RadioGroupItem value={value} id={`purge-mode-${value}`} />
            {label}
          </label>
        ))}
      </RadioGroup>

      {mode === 'partitions' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Partitions &amp; “delete before” offset</Label>
            {partitions.length > 1 ? (
              <button
                type="button"
                className="text-2xs text-[var(--primary)] hover:underline"
                onClick={() =>
                  setRows((prev) => {
                    const next = { ...prev };
                    for (const p of partitions)
                      next[p.id] = {
                        selected: !allSelected,
                        offset: prev[p.id]?.offset ?? String(p.endOffset),
                      };
                    return next;
                  })
                }
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            ) : null}
          </div>
          {loadingPartitions ? (
            <div className="space-y-1.5">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--border)] p-1">
              {partitions.map((p) => {
                const row = rows[p.id] ?? { selected: false, offset: String(p.endOffset) };
                const parsed = parseOffset(row.offset);
                const invalid =
                  row.selected && (parsed === null || parsed < 0 || parsed > p.endOffset);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1',
                      row.selected && 'bg-[var(--surface-2)]',
                    )}
                  >
                    <Checkbox
                      checked={row.selected}
                      onCheckedChange={(v) => setRow(p.id, { selected: v === true })}
                      aria-label={`Purge partition ${p.id}`}
                    />
                    <span className="w-8 font-mono text-[13px] tabular-nums">{p.id}</span>
                    <span className="flex-1 truncate font-mono text-2xs tabular-nums text-[var(--muted)]">
                      {formatNumber(p.beginOffset)} – {formatNumber(p.endOffset)}
                    </span>
                    <Input
                      mono
                      type="number"
                      min={0}
                      max={p.endOffset}
                      className="h-7 w-32 text-[13px]"
                      value={row.offset}
                      disabled={!row.selected}
                      aria-invalid={invalid}
                      aria-label={`Delete partition ${p.id} records before offset`}
                      onChange={(e) => setRow(p.id, { offset: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {selectedRows.length === 0 ? (
            <p className="text-2xs text-[var(--muted)]">Select at least one partition.</p>
          ) : invalidRows.length > 0 ? (
            <p className="text-2xs text-[var(--danger)]">
              Offsets must be whole numbers between 0 and the partition&apos;s end offset.
            </p>
          ) : (
            <p className="text-2xs text-[var(--muted)]">
              Records with offset &lt; the entered value are deleted. Defaults to the end offset
              (everything).
            </p>
          )}
        </div>
      ) : null}

      {needsAck ? <InternalTopicAck checked={ack} onCheckedChange={setAck} /> : null}
      {needsAck && !ack ? (
        <p className="text-2xs text-[var(--danger)]">Acknowledge the warning above to continue.</p>
      ) : null}
    </ConfirmDestructiveDialog>
  );
}
