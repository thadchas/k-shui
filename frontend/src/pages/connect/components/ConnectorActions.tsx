import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
} from 'lucide-react';
import { useConnectorAction, useDeleteConnector, type ConnectorAction } from '@/api/hooks/connect';
import type { Connector } from '@/api/types';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast, toastError } from '@/components/ui/toast';
import { taskCounts } from './connectUtils';

/** Proper past tense for action toasts (`stop` → "stopped", not "stopd"). */
export const ACTION_PAST_TENSE: Record<ConnectorAction, string> = {
  pause: 'paused',
  resume: 'resumed',
  stop: 'stopped',
  restart: 'restarted',
};

export interface StopConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectorName: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** Explains STOPPED vs PAUSED before stopping a connector. */
export function StopConnectorDialog({
  open,
  onOpenChange,
  connectorName,
  loading,
  onConfirm,
}: StopConnectorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]">
              <Square className="size-4 text-[var(--warning)]" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Stop connector</DialogTitle>
              <DialogDescription>
                Stops <span className="font-mono">{connectorName}</span> and releases all of its
                tasks.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody>
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-[var(--muted)]">
            <li>
              <span className="font-mono text-[var(--foreground)]">STOPPED</span> shuts down the
              connector and its tasks; worker resources are freed and the connector no longer
              processes records. This is the state required to edit or reset offsets.
            </li>
            <li>
              <span className="font-mono text-[var(--foreground)]">PAUSED</span> keeps tasks
              allocated but idle, so resuming is faster — offsets stay read-only.
            </li>
            <li>Use Resume to bring the connector back to RUNNING afterwards.</li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => void onConfirm()}>
            <Square /> Stop connector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConnectorActionsMenuProps {
  cluster: string;
  kc: string;
  connector: Connector;
  /** Called after a successful delete. */
  onDeleted?: () => void;
  /** Render the trigger as a labelled button instead of a kebab icon. */
  labelled?: boolean;
}

/** Pause / resume / stop / restart / edit / delete for a single connector. */
export function ConnectorActionsMenu({
  cluster,
  kc,
  connector,
  onDeleted,
  labelled,
}: ConnectorActionsMenuProps) {
  const navigate = useNavigate();
  const action = useConnectorAction(cluster, kc);
  const remove = useDeleteConnector(cluster, kc);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const state = (connector.state ?? '').toUpperCase();
  const counts = taskCounts(connector.tasks);

  const run = async (
    kind: ConnectorAction,
    options?: { includeTasks?: boolean; onlyFailed?: boolean },
    message?: string,
  ) => {
    try {
      await action.mutateAsync({ name: connector.name, action: kind, ...options });
      toast.success(message ?? `${connector.name} ${ACTION_PAST_TENSE[kind]}`);
      return true;
    } catch (e) {
      toastError(`Failed to ${kind} connector`, e);
      return false;
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {labelled ? (
            <Button variant="outline" loading={action.isPending}>
              Actions <MoreHorizontal />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${connector.name}`}>
              <MoreHorizontal />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {state === 'PAUSED' || state === 'STOPPED' ? (
            <DropdownMenuItem onSelect={() => void run('resume')}>
              <Play /> Resume
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void run('pause')}>
              <Pause /> Pause
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={state === 'STOPPED'} onSelect={() => setConfirmStop(true)}>
            <Square /> Stop
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void run('restart', { includeTasks: true }, `${connector.name} restarted`)
            }
          >
            <RotateCcw /> Restart (with tasks)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={counts.failed === 0}
            onSelect={() =>
              void run(
                'restart',
                { includeTasks: true, onlyFailed: true },
                `Restarted ${counts.failed} failed task${counts.failed === 1 ? '' : 's'}`,
              )
            }
          >
            <RefreshCw /> Restart failed tasks
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              void navigate(
                `/c/${cluster}/connect/${encodeURIComponent(kc)}/connectors/${encodeURIComponent(connector.name)}?tab=config`,
              )
            }
          >
            <Settings2 /> Edit config
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete connector
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <StopConnectorDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        connectorName={connector.name}
        loading={action.isPending}
        onConfirm={async () => {
          if (await run('stop')) setConfirmStop(false);
        }}
      />

      <ConfirmDestructiveDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete connector"
        description={
          <>
            Removes <span className="font-mono">{connector.name}</span> from the Connect cluster and
            stops all of its tasks. Committed offsets are kept unless you reset them.
          </>
        }
        confirmText={connector.name}
        confirmLabel="Delete connector"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(connector.name);
            toast.success(`Connector ${connector.name} deleted`);
            setConfirmDelete(false);
            onDeleted?.();
          } catch (e) {
            toastError('Failed to delete connector', e);
          }
        }}
      />
    </>
  );
}
