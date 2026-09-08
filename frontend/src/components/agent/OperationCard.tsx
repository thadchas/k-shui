import { useState } from 'react';
import { Link } from 'react-router';
import type { AgentOperation } from '@/api/agentTypes';
import { useAgentActions } from '@/api/hooks/agent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { operationCanExecute, safeEvidenceHref, stateLabel } from './agentUtils';
import { useAgentClock } from './useAgentClock';

export function OperationCard({
  operation,
  canOperate,
}: {
  operation: AgentOperation;
  canOperate: boolean;
}) {
  const [confirmation, setConfirmation] = useState('');
  const { execute, cancelOperation, reprepare } = useAgentActions();
  const now = useAgentClock();
  const busy = execute.isPending || cancelOperation.isPending || reprepare.isPending;
  const pending = ['prepared', 'awaiting_confirmation'].includes(operation.status);
  const href = safeEvidenceHref(operation.href);
  const expired =
    !Number.isFinite(Date.parse(operation.expiresAt)) || Date.parse(operation.expiresAt) <= now;
  return (
    <article
      aria-label={`Operation ${operation.action}`}
      className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{operation.action}</h3>
        <Badge variant={operation.status === 'succeeded' ? 'success' : 'warning'}>
          {stateLabel(operation.status)}
        </Badge>
      </div>
      <p className="break-all">
        Cluster <strong>{operation.clusterId}</strong> · <strong>{operation.target.name}</strong>
        {operation.target.taskId !== undefined && ` · Task ${operation.target.taskId}`}
      </p>
      <p className="text-xs text-[var(--muted)]">
        Acting user: {operation.user} · Preview expires{' '}
        <time dateTime={operation.expiresAt}>{new Date(operation.expiresAt).toLocaleString()}</time>
      </p>
      <div>
        <h4 className="mb-1 font-medium">Exact effect</h4>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--surface-2)] p-3 text-xs">
          {JSON.stringify(operation.preview, null, 2)}
        </pre>
      </div>
      <details>
        <summary className="cursor-pointer">Parameters and before / after evidence</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(
            {
              parameters: operation.parameters,
              before: operation.before,
              after: operation.after ?? 'Not verified yet',
            },
            null,
            2,
          )}
        </pre>
      </details>
      {pending && (
        <p className="text-xs text-[var(--muted)]">
          Execution checks your current permissions and resource state again. Cancellation cannot
          undo an accepted Kafka operation.
        </p>
      )}
      {pending && operation.requiresConfirmation && (
        <label className="block space-y-2 text-xs" htmlFor={`confirm-${operation.id}`}>
          <span>
            Type <strong className="select-all font-mono">{operation.confirmationText}</strong> to
            confirm this exact operation.
          </span>
          <Input
            id={`confirm-${operation.id}`}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      {pending && (
        <Button
          disabled={
            !canOperate ||
            !operationCanExecute(operation, confirmation, now) ||
            busy ||
            execute.isError
          }
          onClick={() =>
            execute.mutate({
              id: operation.investigationId,
              operationId: operation.id,
              confirmation,
            })
          }
        >
          {execute.isPending
            ? 'Executing…'
            : expired
              ? 'Preview expired'
              : operation.requiresConfirmation
                ? 'Confirm and execute'
                : 'Execute prepared change'}
        </Button>
      )}
      {pending && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              cancelOperation.mutate({
                id: operation.investigationId,
                operationId: operation.id,
              })
            }
          >
            {cancelOperation.isPending ? 'Cancelling…' : 'Cancel prepared change'}
          </Button>
          {expired && !execute.isError && (
            <Button
              variant="outline"
              disabled={!canOperate || busy || reprepare.isError}
              onClick={() => reprepare.mutate(operation)}
            >
              {reprepare.isPending ? 'Preparing…' : 'Prepare new preview'}
            </Button>
          )}
        </div>
      )}
      {(cancelOperation.error || reprepare.error) && (
        <p role="alert" className="text-[var(--danger)]">
          {cancelOperation.error?.message ?? reprepare.error?.message} Reload the investigation to
          check saved state.
        </p>
      )}
      {(operation.status === 'outcome_unknown' || execute.isError) && (
        <p role="alert" className="text-[var(--warning)]">
          {execute.error?.message || operation.error || 'The outcome is unknown.'} Refresh the
          investigation and reconcile the resource state before requesting another operation. This
          operation will not be automatically retried.
        </p>
      )}
      {operation.error && operation.status !== 'outcome_unknown' && (
        <p role="alert" className="text-[var(--danger)]">
          {operation.error}
        </p>
      )}
      {href && (
        <Link className="inline-block text-[var(--primary)] underline" to={href}>
          Open resource
        </Link>
      )}
    </article>
  );
}
