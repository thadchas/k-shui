import { useElectLeaders } from '@/api/hooks/partitions';
import type { ElectLeadersResponse, ElectionType, PartitionRef } from '@/api/types';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { toast, toastError } from '@/components/ui/toast';

export interface ElectLeadersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId: string;
  /** Partitions to elect on; empty = every partition in the cluster. */
  partitions: PartitionRef[];
  electionType?: ElectionType;
  onDone?: (result: ElectLeadersResponse) => void;
}

export function summarizeElection(result: ElectLeadersResponse): string {
  const parts = [`${result.succeeded} elected`];
  if (result.notNeeded > 0) parts.push(`${result.notNeeded} already preferred`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  return parts.join(' · ');
}

/**
 * Confirmation for a preferred (or unclean) leader election. Elections are safe but move
 * traffic between brokers, so they still go through the destructive-confirm pattern.
 */
export function ElectLeadersDialog({
  open,
  onOpenChange,
  clusterId,
  partitions,
  electionType = 'preferred',
  onDone,
}: ElectLeadersDialogProps) {
  const elect = useElectLeaders(clusterId);
  const scope =
    partitions.length === 0
      ? 'every partition in the cluster'
      : partitions.length === 1
        ? `${partitions[0]!.topic}-${partitions[0]!.partition}`
        : `${partitions.length} selected partitions`;
  const unclean = electionType === 'unclean';

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={unclean ? 'Run unclean leader election' : 'Elect preferred leaders'}
      description={
        unclean
          ? `Force a leader for ${scope} from any replica, including out-of-sync ones. This can lose committed messages.`
          : `Move leadership of ${scope} back to the first replica in each assignment. Clients will briefly re-fetch metadata while leaders switch.`
      }
      acknowledgeLabel={
        unclean
          ? 'I understand an unclean election can lose acknowledged data.'
          : 'Leadership will move between brokers; producers and consumers may see a short retry.'
      }
      confirmLabel={unclean ? 'Force election' : 'Elect leaders'}
      loading={elect.isPending}
      onConfirm={async () => {
        try {
          const result = await elect.mutateAsync({ partitions, electionType });
          if (result.failed > 0) {
            const first = result.items.find((i) => i.status === 'failed');
            toast.warning('Leader election finished with errors', {
              description: `${summarizeElection(result)}${first?.error ? ` — ${first.error}` : ''}`,
            });
          } else {
            toast.success('Leader election complete', { description: summarizeElection(result) });
          }
          onDone?.(result);
          onOpenChange(false);
        } catch (e) {
          toastError('Leader election failed', e);
        }
      }}
    />
  );
}
