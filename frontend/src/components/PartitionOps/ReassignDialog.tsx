import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Crown, X } from 'lucide-react';
import { useBrokers } from '@/api/hooks/brokers';
import { usePartitionCapabilities, useReassign } from '@/api/hooks/partitions';
import { ApiError } from '@/api/client';
import type { PartitionDetail, ReassignmentJson } from '@/api/types';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeBlock } from '@/components/ui/code-block';
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
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

export interface ReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId: string;
  topic: string;
  partition: PartitionDetail | null;
}

/** Fallback payload shown when the backend answers 501 (client lacks the reassignment API). */
export interface UnsupportedReassignment {
  detail: string;
  reassignmentJson?: ReassignmentJson;
  command?: string;
}

export function unsupportedFromError(error: unknown): UnsupportedReassignment | null {
  if (!(error instanceof ApiError) || error.status !== 501) return null;
  const problem = error.problem ?? {};
  return {
    detail: error.detail || error.title,
    reassignmentJson: problem.reassignmentJson as ReassignmentJson | undefined,
    command: typeof problem.command === 'string' ? problem.command : undefined,
  };
}

function sameReplicas(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Edit the replica set of one partition. Order matters — the first replica is the preferred
 * leader — so the target list is an ordered list rather than a plain multi-select.
 */
export function ReassignDialog({
  open,
  onOpenChange,
  clusterId,
  topic,
  partition,
}: ReassignDialogProps) {
  const { canEdit } = usePermissions();
  const brokers = useBrokers(open ? clusterId : undefined);
  const capabilities = usePartitionCapabilities(open ? clusterId : undefined);
  const reassign = useReassign(clusterId);

  const [target, setTarget] = useState<number[]>([]);
  const [throttle, setThrottle] = useState('');
  const [typed, setTyped] = useState('');
  const [unsupported, setUnsupported] = useState<UnsupportedReassignment | null>(null);

  useEffect(() => {
    if (open && partition) {
      setTarget([...partition.replicas]);
      setThrottle('');
      setTyped('');
      setUnsupported(null);
    }
  }, [open, partition]);

  const label = partition ? `${topic}-${partition.id}` : topic;
  const brokerRows = useMemo(
    () => [...(brokers.data ?? [])].sort((a, b) => a.id - b.id),
    [brokers.data],
  );
  const changed = partition ? !sameReplicas(partition.replicas, target) : false;
  const throttleValue = throttle.trim() === '' ? undefined : Number(throttle);
  const throttleInvalid =
    throttleValue !== undefined && (!Number.isFinite(throttleValue) || throttleValue < 1);
  const applySupported = capabilities.data?.reassign ?? true;
  const canApply =
    canEdit &&
    applySupported &&
    changed &&
    target.length > 0 &&
    !throttleInvalid &&
    typed === label &&
    !reassign.isPending;

  const preview: ReassignmentJson | null = partition
    ? { version: 1, partitions: [{ topic, partition: partition.id, replicas: target }] }
    : null;

  const toggle = (id: number, on: boolean) =>
    setTarget((prev) =>
      on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((r) => r !== id),
    );
  const move = (index: number, delta: number) =>
    setTarget((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });

  const apply = async () => {
    if (!partition) return;
    try {
      const result = await reassign.mutateAsync({
        partitions: [{ topic, partition: partition.id, replicas: target }],
        ...(throttleValue !== undefined ? { throttleBytesPerSec: throttleValue } : {}),
      });
      const failed = result.items.filter((i) => i.error);
      if (failed.length) {
        toast.warning('Reassignment submitted with errors', {
          description: failed[0]!.error ?? '',
        });
      } else {
        toast.success(`Reassignment of ${label} started`, {
          description: `Target replicas ${target.join(', ')}${throttleValue ? ` · throttled to ${throttleValue} B/s` : ''}`,
        });
      }
      onOpenChange(false);
    } catch (e) {
      const fallback = unsupportedFromError(e);
      if (fallback) setUnsupported(fallback);
      else toastError('Reassignment failed', e);
    }
  };

  const disabledReason = !canEdit
    ? REQUIRES_EDITOR
    : !applySupported
      ? `Applying reassignments needs a newer Kafka client (backend has confluent-kafka ${capabilities.data?.clientVersion ?? '?'}). Copy the JSON below and run kafka-reassign-partitions.sh instead.`
      : !changed
        ? 'Target replicas match the current assignment'
        : target.length === 0
          ? 'Pick at least one replica'
          : typed !== label
            ? `Type ${label} to confirm`
            : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Reassign replicas</DialogTitle>
          <DialogDescription>
            Move <span className="font-mono text-[var(--foreground)]">{label}</span> to a new set of
            brokers. The first replica becomes the preferred leader. Data is copied before old
            replicas are dropped, so the move is safe but disk- and network-heavy.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {partition ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Brokers</Label>
                <div className="max-h-56 space-y-1 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] p-2">
                  {brokers.isLoading ? (
                    <p className="text-xs text-[var(--muted)]">Loading brokers…</p>
                  ) : brokerRows.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No brokers reported.</p>
                  ) : (
                    brokerRows.map((b) => {
                      const selected = target.includes(b.id);
                      const inIsr = partition.isr.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--surface-2)]"
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(v) => toggle(b.id, v === true)}
                            aria-label={`Broker ${b.id}`}
                          />
                          <span className="font-mono tabular-nums">{b.id}</span>
                          <span className="truncate text-[var(--muted)]">
                            {b.host}:{b.port}
                          </span>
                          {b.rack ? (
                            <Badge variant="secondary" size="sm">
                              {b.rack}
                            </Badge>
                          ) : null}
                          {partition.replicas.includes(b.id) ? (
                            <Badge variant={inIsr ? 'success' : 'danger'} size="sm">
                              {inIsr ? 'current · in sync' : 'current · out of sync'}
                            </Badge>
                          ) : null}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target replicas (in order)</Label>
                <ol className="space-y-1 rounded-[var(--radius-control)] border border-[var(--border)] p-2">
                  {target.length === 0 ? (
                    <li className="text-xs text-[var(--muted)]">Select at least one broker.</li>
                  ) : (
                    target.map((id, index) => (
                      <li key={id} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded bg-[var(--surface-2)] px-1 font-mono tabular-nums">
                          {index === 0 ? (
                            <Crown className="size-2.5" aria-label="Preferred leader" />
                          ) : null}
                          {id}
                        </span>
                        <span className="text-[var(--muted)]">
                          {index === 0 ? 'preferred leader' : `replica ${index + 1}`}
                        </span>
                        <span className="ml-auto inline-flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move down"
                            disabled={index === target.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Remove"
                            onClick={() => toggle(id, false)}
                          >
                            <X />
                          </Button>
                        </span>
                      </li>
                    ))
                  )}
                </ol>
                <p className="text-xs text-[var(--muted)]">
                  Current: <span className="font-mono">{partition.replicas.join(', ')}</span> →
                  Proposed:{' '}
                  <span className={changed ? 'font-mono text-[var(--foreground)]' : 'font-mono'}>
                    {target.length ? target.join(', ') : '—'}
                  </span>
                  {target.length !== partition.replicas.length ? (
                    <Badge variant="warning" size="sm" className="ml-2">
                      RF {partition.replicas.length} → {target.length}
                    </Badge>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="reassign-throttle">Throttle (bytes/sec, optional)</Label>
              <Input
                id="reassign-throttle"
                mono
                inputMode="numeric"
                placeholder="e.g. 50000000"
                value={throttle}
                invalid={throttleInvalid}
                onChange={(e) => setThrottle(e.target.value)}
              />
              <p className="text-2xs text-[var(--muted)]">
                Sets leader/follower replication.throttled.rate on brokers and the throttled replica
                lists on the topic. Remember to clear them once the move finishes.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reassign-confirm">
                Type <span className="font-mono text-[var(--foreground)]">{label}</span> to confirm
              </Label>
              <Input
                id="reassign-confirm"
                mono
                autoComplete="off"
                value={typed}
                placeholder={label}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          </div>

          {!applySupported || unsupported ? (
            <div className="space-y-2">
              <p className="text-xs text-[var(--warning)]">
                {unsupported?.detail ??
                  `This backend's Kafka client (confluent-kafka ${capabilities.data?.clientVersion ?? '?'}) cannot submit reassignments. Save the JSON below and run it with the Kafka CLI.`}
              </p>
              <CodeBlock
                title="reassignment.json"
                code={JSON.stringify(unsupported?.reassignmentJson ?? preview, null, 2)}
                maxHeight={160}
              />
              <CodeBlock
                title="command"
                wrap
                code={
                  unsupported?.command ??
                  `kafka-reassign-partitions.sh --bootstrap-server <bootstrap> --reassignment-json-file reassignment.json${throttleValue ? ` --throttle ${throttleValue}` : ''} --execute`
                }
                maxHeight={80}
              />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Tooltip content={disabledReason}>
            <span>
              <Button
                variant="destructive"
                disabled={!canApply}
                loading={reassign.isPending}
                onClick={() => void apply()}
              >
                Apply reassignment
              </Button>
            </span>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
