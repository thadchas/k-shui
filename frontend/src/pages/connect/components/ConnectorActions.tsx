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
import { useConnectorAction, useDeleteConnector } from '@/api/hooks/connect';
import type { Connector } from '@/api/types';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast, toastError } from '@/components/ui/toast';
import { taskCounts } from './connectUtils';

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

  const state = (connector.state ?? '').toUpperCase();
  const counts = taskCounts(connector.tasks);

  const run = async (
    kind: 'pause' | 'resume' | 'stop' | 'restart',
    options?: { includeTasks?: boolean; onlyFailed?: boolean },
    message?: string,
  ) => {
    try {
      await action.mutateAsync({ name: connector.name, action: kind, ...options });
      toast.success(message ?? `${connector.name} ${kind}d`);
    } catch (e) {
      toastError(`Failed to ${kind} connector`, e);
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
          <DropdownMenuItem disabled={state === 'STOPPED'} onSelect={() => void run('stop')}>
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
