import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useResetOffsets } from '@/api/hooks/consumerGroups';
import type { ConsumerGroupDetail, ResetOffsetsResult, ResetStrategy } from '@/api/types';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateTimeInput } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';

const STRATEGIES: { label: string; value: ResetStrategy }[] = [
  { label: 'Earliest — beginning of the log', value: 'earliest' },
  { label: 'Latest — end of the log', value: 'latest' },
  { label: 'Specific offset', value: 'offset' },
  { label: 'Timestamp', value: 'timestamp' },
  { label: 'Shift by N', value: 'shiftBy' },
];

/** Above this many rows the preview gets an explicit "showing X of Y" footer. */
const LONG_PREVIEW = 20;

export interface ResetOffsetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: string;
  group: string;
  detail: ConsumerGroupDetail | undefined;
}

export function ResetOffsetsDialog({
  open,
  onOpenChange,
  cluster,
  group,
  detail,
}: ResetOffsetsDialogProps) {
  const [topic, setTopic] = useState<string>('all');
  const [selectedPartitions, setSelectedPartitions] = useState<Set<number>>(() => new Set());
  const [strategy, setStrategy] = useState<ResetStrategy>('earliest');
  const [offsetValue, setOffsetValue] = useState('0');
  const [shiftValue, setShiftValue] = useState('-100');
  const [timestamp, setTimestamp] = useState<number | null>(Date.now() - 3_600_000);
  const [preview, setPreview] = useState<ResetOffsetsResult[] | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState(false);
  // Which action is in flight — `reset.isPending` alone cannot tell a re-preview from an apply.
  const [pending, setPending] = useState<'preview' | 'apply' | null>(null);

  const reset = useResetOffsets(cluster, group);

  const topics = useMemo(() => {
    const names = new Set((detail?.partitions ?? []).map((p) => p.topic));
    return Array.from(names).sort();
  }, [detail]);

  const topicPartitions = useMemo(() => {
    if (topic === 'all') return [];
    return (detail?.partitions ?? [])
      .filter((p) => p.topic === topic)
      .map((p) => p.partition)
      .sort((a, b) => a - b);
  }, [detail, topic]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setStrategy('earliest');
      setTopic('all');
      setSelectedPartitions(new Set());
      setHideUnchanged(false);
      setPending(null);
    }
  }, [open]);

  const memberCount = detail?.memberCount ?? 0;
  const isActive = memberCount > 0;

  const invalidate = () => setPreview(null);

  const togglePartition = (partition: number) => {
    setSelectedPartitions((prev) => {
      const next = new Set(prev);
      if (next.has(partition)) next.delete(partition);
      else next.add(partition);
      return next;
    });
    invalidate();
  };

  const buildRequest = (dryRun: boolean) => ({
    topic: topic === 'all' ? undefined : topic,
    partitions:
      topic !== 'all' && selectedPartitions.size > 0
        ? Array.from(selectedPartitions).sort((a, b) => a - b)
        : undefined,
    strategy,
    value:
      strategy === 'offset'
        ? Number(offsetValue)
        : strategy === 'shiftBy'
          ? Number(shiftValue)
          : strategy === 'timestamp'
            ? (timestamp ?? undefined)
            : undefined,
    dryRun,
  });

  const runPreview = async () => {
    setPending('preview');
    try {
      const result = await reset.mutateAsync(buildRequest(true));
      setPreview(result);
    } catch (e) {
      toastError('Preview failed', e);
    } finally {
      setPending(null);
    }
  };

  const apply = async () => {
    setPending('apply');
    try {
      const result = await reset.mutateAsync(buildRequest(false));
      const failed = result.filter((r) => 'error' in r && (r as { error?: string }).error);
      if (failed.length > 0) {
        toastError(
          'Reset partially failed',
          new Error(`${failed.length} of ${result.length} partitions were rejected by the broker`),
        );
      } else {
        toast.success('Offsets reset', { description: `${result.length} partitions updated` });
      }
      onOpenChange(false);
    } catch (e) {
      toastError('Reset failed', e);
    } finally {
      setPending(null);
    }
  };

  const isUnchanged = (row: ResetOffsetsResult) => row.oldOffset === row.newOffset;
  const unchangedCount = preview?.filter(isUnchanged).length ?? 0;
  const changedCount = (preview?.length ?? 0) - unchangedCount;
  const visibleRows = useMemo(
    () => (preview ?? []).filter((row) => !(hideUnchanged && isUnchanged(row))),
    [preview, hideUnchanged],
  );

  const applyDisabled = isActive || !preview || changedCount === 0 || pending !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Reset consumer offsets</DialogTitle>
          <DialogDescription>
            Move committed offsets for <span className="font-mono">{group}</span>. Always preview
            before applying.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {isActive ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
              <p className="text-xs text-[var(--foreground)]">
                This group has {memberCount} active member{memberCount === 1 ? '' : 's'}. The broker
                rejects offset resets for non-empty groups, so <strong>Apply</strong> is disabled —
                stop the consumers first. You can still preview the plan.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Topic</Label>
              <SimpleSelect
                value={topic}
                onValueChange={(v) => {
                  setTopic(v);
                  setSelectedPartitions(new Set());
                  invalidate();
                }}
                options={[
                  { label: 'All topics in group', value: 'all' },
                  ...topics.map((t) => ({ label: t, value: t })),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Strategy</Label>
              <SimpleSelect
                value={strategy}
                onValueChange={(v) => {
                  setStrategy(v as ResetStrategy);
                  invalidate();
                }}
                options={STRATEGIES}
              />
            </div>
          </div>

          {topic !== 'all' && topicPartitions.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Partitions</Label>
                <span className="text-2xs text-[var(--muted)]">
                  {selectedPartitions.size === 0
                    ? `All ${topicPartitions.length} partitions`
                    : `${selectedPartitions.size} of ${topicPartitions.length} selected`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Partitions">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPartitions(new Set());
                    invalidate();
                  }}
                  aria-pressed={selectedPartitions.size === 0}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors',
                    selectedPartitions.size === 0
                      ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--primary)]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]',
                  )}
                >
                  all
                </button>
                {topicPartitions.map((partition) => {
                  const selected = selectedPartitions.has(partition);
                  return (
                    <button
                      key={partition}
                      type="button"
                      onClick={() => togglePartition(partition)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 font-mono text-xs tabular-nums transition-colors',
                        selected
                          ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]',
                      )}
                    >
                      {partition}
                    </button>
                  );
                })}
              </div>
              <p className="text-2xs text-[var(--muted)]">
                Leave empty to reset every partition of {topic}.
              </p>
            </div>
          ) : null}

          {strategy === 'offset' ? (
            <div className="space-y-1.5">
              <Label htmlFor="reset-offset">Offset</Label>
              <Input
                id="reset-offset"
                mono
                type="number"
                min={0}
                value={offsetValue}
                onChange={(e) => {
                  setOffsetValue(e.target.value);
                  invalidate();
                }}
              />
            </div>
          ) : null}

          {strategy === 'shiftBy' ? (
            <div className="space-y-1.5">
              <Label htmlFor="reset-shift">Shift by</Label>
              <Input
                id="reset-shift"
                mono
                type="number"
                value={shiftValue}
                onChange={(e) => {
                  setShiftValue(e.target.value);
                  invalidate();
                }}
              />
              <p className="text-2xs text-[var(--muted)]">
                Negative values rewind, positive values skip forward.
              </p>
            </div>
          ) : null}

          {strategy === 'timestamp' ? (
            <div className="space-y-1.5">
              <Label>Timestamp</Label>
              <DateTimeInput
                value={timestamp}
                onChange={(v) => {
                  setTimestamp(v);
                  invalidate();
                }}
              />
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Dry-run preview · {preview.length} partition{preview.length === 1 ? '' : 's'} ·{' '}
                  {changedCount} will change
                  {unchangedCount > 0 ? ` · ${unchangedCount} unchanged` : ''}
                </p>
                {unchangedCount > 0 ? (
                  <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <Switch
                      checked={hideUnchanged}
                      onCheckedChange={setHideUnchanged}
                      aria-label="Hide unchanged partitions"
                    />
                    Hide unchanged
                  </label>
                ) : null}
              </div>
              <div className="max-h-64 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Topic</TableHead>
                      <TableHead numeric>Partition</TableHead>
                      <TableHead numeric>Current</TableHead>
                      <TableHead numeric>New</TableHead>
                      <TableHead numeric>Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="text-center text-xs text-[var(--muted)]">
                          Every partition is already at its target offset.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleRows.map((row) => {
                        const unchanged = isUnchanged(row);
                        const delta = (row.newOffset ?? 0) - (row.oldOffset ?? 0);
                        return (
                          <TableRow
                            key={`${row.topic}-${row.partition}`}
                            className={cn('hover:bg-transparent', unchanged && 'opacity-50')}
                            aria-disabled={unchanged || undefined}
                          >
                            <TableCell className="font-mono text-[13px]">{row.topic}</TableCell>
                            <TableCell numeric>{row.partition}</TableCell>
                            <TableCell numeric>{formatNumber(row.oldOffset)}</TableCell>
                            <TableCell
                              numeric
                              className={unchanged ? undefined : 'text-[var(--primary)]'}
                            >
                              {formatNumber(row.newOffset)}
                            </TableCell>
                            <TableCell
                              numeric
                              className={
                                unchanged
                                  ? 'text-[var(--muted)]'
                                  : delta < 0
                                    ? 'text-[var(--danger)]'
                                    : 'text-[var(--success)]'
                              }
                            >
                              {unchanged
                                ? 'no-op'
                                : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {preview.length > LONG_PREVIEW || hideUnchanged ? (
                <p className="text-2xs text-[var(--muted)]">
                  Showing {visibleRows.length} of {preview.length} rows
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={pending === 'preview'}
            disabled={pending === 'apply'}
            onClick={() => void runPreview()}
          >
            <RotateCcw /> {preview ? 'Re-preview' : 'Preview'}
          </Button>
          <Button
            variant="destructive"
            disabled={applyDisabled}
            loading={pending === 'apply'}
            title={
              isActive
                ? 'The broker rejects offset resets while the group has active members'
                : undefined
            }
            onClick={() => void apply()}
          >
            Apply reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
