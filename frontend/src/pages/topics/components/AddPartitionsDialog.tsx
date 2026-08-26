import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAddPartitions, useTopicConsumers } from '@/api/hooks/topics';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast, toastError } from '@/components/ui/toast';
import { InternalTopicAck, isCompacted } from './InternalTopicAck';

export interface AddPartitionsTopic {
  name: string;
  partitions: number;
  cleanupPolicy: string;
  isInternal: boolean;
}

export interface AddPartitionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: string;
  topic: AddPartitionsTopic | null;
  /** When true and the topic is internal, an extra acknowledgement checkbox is required. */
  requireInternalAck?: boolean;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-xs">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" />
      <span>{children}</span>
    </p>
  );
}

export function AddPartitionsDialog({
  open,
  onOpenChange,
  cluster,
  topic,
  requireInternalAck = false,
}: AddPartitionsDialogProps) {
  const name = topic?.name ?? '';
  const current = topic?.partitions ?? 0;
  const [count, setCount] = useState(current + 1);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (open) {
      setCount(current + 1);
      setAck(false);
    }
  }, [open, current]);

  const addPartitions = useAddPartitions(cluster, name);
  const consumers = useTopicConsumers(cluster, open && name ? name : undefined, open);
  const activeGroups = (consumers.data ?? []).filter((g) => {
    const state = String(g.state).toLowerCase();
    return state !== 'empty' && state !== 'dead';
  });

  const needsAck = requireInternalAck && Boolean(topic?.isInternal);
  const countValid = Number.isInteger(count) && count > current;
  const canSubmit = countValid && (!needsAck || ack);

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add partitions"
      description={
        <>
          Increase the partition count of <span className="font-mono">{name}</span>. This cannot be
          undone and changes key-to-partition mapping for new records.
        </>
      }
      confirmText={name || undefined}
      confirmLabel="Add partitions"
      loading={addPartitions.isPending}
      disabled={!canSubmit}
      disabledReason={
        !countValid
          ? `Enter a whole number greater than ${current}`
          : 'Acknowledge the internal-topic warning to continue'
      }
      onConfirm={async () => {
        if (!topic || !canSubmit) return;
        try {
          await addPartitions.mutateAsync({ count });
          toast.success(`Partitions added to ${name}`);
          onOpenChange(false);
        } catch (e) {
          toastError('Failed to add partitions', e);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="partition-count">New partition count</Label>
        <Input
          id="partition-count"
          type="number"
          min={current + 1}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-invalid={!countValid}
        />
        <p className="text-2xs text-[var(--muted)]">
          Currently {current} partition{current === 1 ? '' : 's'}.
          {!countValid ? (
            <span className="text-[var(--danger)]"> Enter a number greater than {current}.</span>
          ) : null}
        </p>
      </div>

      {topic && isCompacted(topic.cleanupPolicy) ? (
        <Warning>
          <strong>Compacted topic.</strong> Adding partitions breaks the key→partition mapping:
          existing keys stay in their old partition while new writes for the same key may land
          elsewhere, so compaction can no longer collapse them.
        </Warning>
      ) : null}

      {consumers.isLoading ? (
        <p className="text-2xs text-[var(--muted)]">Checking consumer groups…</p>
      ) : activeGroups.length > 0 ? (
        <Warning>
          <strong>
            {activeGroups.length} active consumer group{activeGroups.length === 1 ? '' : 's'}
          </strong>{' '}
          (
          {activeGroups
            .slice(0, 3)
            .map((g) => g.groupId)
            .join(', ')}
          {activeGroups.length > 3 ? ', …' : ''}) will rebalance, and any per-key ordering
          assumptions may break.
        </Warning>
      ) : null}

      {needsAck ? <InternalTopicAck checked={ack} onCheckedChange={setAck} /> : null}
      {needsAck && !ack ? (
        <p className="text-2xs text-[var(--danger)]">Acknowledge the warning above to continue.</p>
      ) : null}
    </ConfirmDestructiveDialog>
  );
}
