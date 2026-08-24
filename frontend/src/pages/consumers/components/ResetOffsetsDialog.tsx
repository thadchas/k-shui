import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useResetOffsets } from '@/api/hooks/consumerGroups';
import type { ConsumerGroupDetail, ResetOffsetsResult, ResetStrategy } from '@/api/types';
import { formatNumber } from '@/lib/format';
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
  const [strategy, setStrategy] = useState<ResetStrategy>('earliest');
  const [offsetValue, setOffsetValue] = useState('0');
  const [shiftValue, setShiftValue] = useState('-100');
  const [timestamp, setTimestamp] = useState<number | null>(Date.now() - 3_600_000);
  const [preview, setPreview] = useState<ResetOffsetsResult[] | null>(null);

  const reset = useResetOffsets(cluster, group);

  const topics = useMemo(() => {
    const names = new Set((detail?.partitions ?? []).map((p) => p.topic));
    return Array.from(names).sort();
  }, [detail]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setStrategy('earliest');
      setTopic('all');
    }
  }, [open]);

  const isActive = (detail?.memberCount ?? 0) > 0;

  const buildRequest = (dryRun: boolean) => ({
    topic: topic === 'all' ? undefined : topic,
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
    try {
      const result = await reset.mutateAsync(buildRequest(true));
      setPreview(result);
    } catch (e) {
      toastError('Preview failed', e);
    }
  };

  const apply = async () => {
    try {
      const result = await reset.mutateAsync(buildRequest(false));
      toast.success('Offsets reset', { description: `${result.length} partitions updated` });
      onOpenChange(false);
    } catch (e) {
      toastError('Reset failed', e);
    }
  };

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
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
              <p className="text-xs text-[var(--foreground)]">
                This group has {detail?.memberCount} active member(s). Kafka only allows resetting
                offsets for an inactive group — stop the consumers first.
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
                  setPreview(null);
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
                  setPreview(null);
                }}
                options={STRATEGIES}
              />
            </div>
          </div>

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
                  setPreview(null);
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
                  setPreview(null);
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
                  setPreview(null);
                }}
              />
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Dry-run preview ({preview.length} partitions)
              </p>
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
                    {preview.map((row) => {
                      const delta = (row.newOffset ?? 0) - (row.oldOffset ?? 0);
                      return (
                        <TableRow
                          key={`${row.topic}-${row.partition}`}
                          className="hover:bg-transparent"
                        >
                          <TableCell className="font-mono text-[13px]">{row.topic}</TableCell>
                          <TableCell numeric>{row.partition}</TableCell>
                          <TableCell numeric>{formatNumber(row.oldOffset)}</TableCell>
                          <TableCell numeric className="text-[var(--primary)]">
                            {formatNumber(row.newOffset)}
                          </TableCell>
                          <TableCell
                            numeric
                            className={delta < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}
                          >
                            {delta > 0 ? '+' : ''}
                            {formatNumber(delta)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={reset.isPending && !preview}
            onClick={() => void runPreview()}
          >
            <RotateCcw /> Preview
          </Button>
          <Button
            variant="destructive"
            disabled={!preview || preview.length === 0}
            loading={reset.isPending && Boolean(preview)}
            onClick={() => void apply()}
          >
            Apply reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
