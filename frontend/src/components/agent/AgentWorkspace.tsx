import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { History, Plus, Send, Square, X } from 'lucide-react';
import {
  useAgentActions,
  useAgentStatus,
  useInvestigation,
  useInvestigations,
} from '@/api/hooks/agent';
import { useInfo } from '@/api/hooks/system';
import type { AgentContext, AgentMode } from '@/api/agentTypes';
import { useAgentStore } from '@/stores/agent';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EvidenceCard } from './EvidenceCard';
import { OperationCard } from './OperationCard';
import { stateLabel } from './agentUtils';
import { agentStarters } from './agentStarters';
import { EvidenceReferences } from './EvidenceReferences';

const selectStyle =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--primary)]';

export function AgentWorkspace() {
  const { cluster } = useParams<{ cluster: string }>();
  const status = useAgentStatus();
  const info = useInfo();
  const {
    context,
    investigationId,
    selectInvestigation,
    setContext,
    draft: input,
    setDraft: setInput,
  } = useAgentStore();
  const detail = useInvestigation(investigationId);
  const history = useInvestigations(!!status.data?.enabled);
  const actions = useAgentActions();
  const [connectionId, setConnectionId] = useState('');
  const [mode, setMode] = useState<AgentMode>('inspect');
  const [showHistory, setShowHistory] = useState(false);
  const investigation = detail.data;
  const scope = investigation ?? context;
  const clusterId = scope.clusterId ?? cluster ?? '';
  const connections = (status.data?.connections ?? []).filter((connection) =>
    connection.allowedClusters.includes(clusterId),
  );
  const selectedConnection =
    connections.find((connection) => connection.id === connectionId) ?? connections[0];
  const running =
    investigation?.status === 'running' || actions.send.isPending || actions.create.isPending;
  const canOperate = !!status.data?.effectiveModes.includes('operate');
  const effectiveMode = investigation?.mode ?? (canOperate ? mode : 'inspect');
  const starters = agentStarters(scope.resource, effectiveMode, selectedConnection?.allowedTools);
  const error = actions.create.error ?? actions.send.error ?? actions.cancel.error;
  const newContext = (next: AgentContext) => {
    setContext(next);
    setInput('');
    actions.create.reset();
    actions.send.reset();
    actions.cancel.reset();
  };
  const send = async (content: string) => {
    if (!content.trim() || running || !clusterId || (!investigationId && !selectedConnection))
      return;
    try {
      let id = investigationId;
      if (!id) {
        const created = await actions.create.mutateAsync({
          clusterId,
          connectionId: selectedConnection!.id,
          mode: effectiveMode,
          resource: context.resource,
          timeWindow: context.timeWindow,
        });
        id = created.id;
        selectInvestigation(id);
      }
      await actions.send.mutateAsync({ id, content });
      setInput('');
    } catch {
      setInput(content);
      /* The mutation error remains visible; mutations are never retried automatically. */
    }
  };

  if (status.isPending)
    return (
      <p role="status" className="p-5 text-sm">
        Loading K-Shui Agent…
      </p>
    );
  if (status.error)
    return (
      <div className="space-y-3 p-5">
        <p role="alert">Agent settings are unavailable: {status.error.message}</p>
        <Button onClick={() => void status.refetch()}>Retry connection</Button>
      </div>
    );
  if (!status.data?.enabled)
    return (
      <div className="space-y-3 p-5">
        <h2 className="font-semibold">
          {status.data?.reason === 'authentication_required'
            ? 'Sign in to use K-Shui Agent'
            : 'K-Shui Agent is disabled'}
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {status.data?.reason === 'authentication_required'
            ? 'The agent requires an authenticated human user. Configure authentication and sign in to preserve individual permissions and private investigations.'
            : 'An administrator must enable the agent and configure an AI connection.'}
        </p>
        <Link className="text-[var(--primary)] underline" to="/agent/settings">
          AI connections and data policy
        </Link>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => newContext({ clusterId: cluster ?? clusterId })}
            >
              <Plus />
              New investigation
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              aria-expanded={showHistory}
            >
              <History />
              History
            </Button>
          </div>
          <Link to="/agent/settings" className="text-xs text-[var(--primary)] underline">
            AI connections
          </Link>
        </div>
        {showHistory && (
          <section
            aria-label="Saved investigations"
            className="max-h-52 space-y-2 overflow-auto rounded border border-[var(--border)] p-3"
          >
            <p className="text-xs text-[var(--muted)]">
              Investigations are saved automatically for your user.
            </p>
            {history.isPending ? (
              <p role="status">Loading history…</p>
            ) : history.error ? (
              <div role="alert">
                History unavailable.{' '}
                <Button size="sm" onClick={() => void history.refetch()}>
                  Retry
                </Button>
              </div>
            ) : !history.data?.length ? (
              <p className="text-sm">No saved investigations yet.</p>
            ) : (
              history.data.map((item) => (
                <button
                  key={item.id}
                  className="block w-full rounded p-2 text-left text-xs hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                  onClick={() => {
                    selectInvestigation(item.id);
                    setShowHistory(false);
                    setInput('');
                  }}
                >
                  <strong className="block truncate">{item.title}</strong>
                  {item.clusterId} · {stateLabel(item.status)} ·{' '}
                  {new Date(item.updatedAt).toLocaleString()}
                </button>
              ))
            )}
          </section>
        )}
        <div
          aria-label="Investigation context"
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <Badge
            variant="outline"
            title={`Every tool call is scoped to cluster ${clusterId || 'not selected'}`}
          >
            Cluster: {clusterId || 'Choose below'}
          </Badge>
          {scope.resource && (
            <span className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border)] px-2 py-1">
              <details className="min-w-0">
                <summary className="cursor-pointer break-all">
                  {scope.resource.type}: {scope.resource.name}
                </summary>
                <pre className="max-w-full overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(scope.resource, null, 2)}
                </pre>
              </details>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove resource and start a new investigation"
                onClick={() => newContext({ clusterId, timeWindow: scope.timeWindow })}
              >
                <X />
              </Button>
            </span>
          )}
          <Badge variant="secondary">
            User: {investigation?.actingUser ?? status.data.actingUser}
          </Badge>
          <Badge variant="outline">
            {investigation?.provider ?? selectedConnection?.provider ?? 'No provider'} /{' '}
            {investigation?.model ?? selectedConnection?.model ?? 'No model'}
          </Badge>
          <Badge>{stateLabel(effectiveMode)}</Badge>
          {scope.timeWindow?.start || scope.timeWindow?.end ? (
            <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1">
              <details>
                <summary className="cursor-pointer">Selected time window</summary>
                <p>
                  {scope.timeWindow.start ?? 'Beginning'} → {scope.timeWindow.end ?? 'Now'}
                </p>
              </details>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove time window and start a new investigation"
                onClick={() => newContext({ clusterId, resource: scope.resource })}
              >
                <X />
              </Button>
            </span>
          ) : (
            <Badge variant="secondary">Current bounded snapshot</Badge>
          )}
        </div>
        {cluster && investigation && cluster !== investigation.clusterId && (
          <p role="status" className="text-xs text-[var(--warning)]">
            This investigation remains scoped to {investigation.clusterId}. Start a new
            investigation to use the current cluster {cluster}.
          </p>
        )}
        {!investigationId && (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs">
              Cluster
              <select
                aria-label="Investigation cluster"
                className={selectStyle}
                value={clusterId}
                onChange={(e) => newContext({ clusterId: e.target.value })}
              >
                <option value="">Select cluster</option>
                {info.data?.clusters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              AI connection
              <select
                aria-label="AI connection"
                className={selectStyle}
                value={selectedConnection?.id ?? ''}
                onChange={(e) => setConnectionId(e.target.value)}
              >
                <option value="" disabled>
                  Select connection
                </option>
                {connections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              Mode
              <select
                className={selectStyle}
                value={effectiveMode}
                onChange={(e) => setMode(e.target.value as AgentMode)}
              >
                <option value="inspect">Inspect</option>
                <option value="operate" disabled={!canOperate}>
                  Operate{!canOperate ? ' — unavailable' : ''}
                </option>
              </select>
            </label>
          </div>
        )}
        <p className="text-xs text-[var(--muted)]">
          Metadata, metrics and redacted configuration only. Message payloads are excluded. Operate
          uses your existing permissions.
        </p>
        {!investigation &&
          selectedConnection?.state &&
          selectedConnection.state !== 'connected' && (
            <p role="status" className="text-xs text-[var(--warning)]">
              Connection: {stateLabel(selectedConnection.state)}. {selectedConnection.recovery}
            </p>
          )}
        {!selectedConnection && !investigation && (
          <p role="alert" className="text-xs text-[var(--warning)]">
            No AI connection is available for this cluster. Ask an administrator to configure one in
            deployment settings.
          </p>
        )}
      </div>
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        aria-label="Investigation conversation"
      >
        {detail.isPending && investigationId && <p role="status">Loading investigation…</p>}
        {detail.error && (
          <div role="alert">
            <p>Investigation unavailable: {detail.error.message}</p>
            <Button onClick={() => void detail.refetch()}>Reload saved investigation</Button>
          </div>
        )}
        {!investigationId && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">What needs attention?</h2>
            <p className="text-sm text-[var(--muted)]">
              Investigate a resource, compare the evidence, or prepare a supported change.
            </p>
            <div className="grid gap-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  className="rounded-[var(--radius-control)] border border-[var(--border)] p-3 text-left text-sm hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                  onClick={() => setInput(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </section>
        )}
        {investigation?.messages.map((message) => (
          <article
            key={message.id}
            className="space-y-2 rounded-[var(--radius-card)] bg-[var(--surface-2)] p-3"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <strong>{message.role === 'user' ? 'You' : 'K-Shui analysis'}</strong>
              <time className="text-[var(--muted)]" dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString()}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.role === 'assistant' ? (
                <EvidenceReferences
                  content={message.content}
                  evidenceIds={message.evidenceIds}
                  evidence={investigation.evidence}
                />
              ) : (
                message.content
              )}
            </p>
          </article>
        ))}
        {!!investigation?.evidence.length && (
          <section aria-label="Retrieved evidence" className="space-y-2">
            <h3 className="text-sm font-semibold">Source evidence</h3>
            {investigation.evidence.map((evidence) => (
              <EvidenceCard
                key={evidence.id}
                evidence={evidence}
                investigationId={investigation.id}
                running={running}
              />
            ))}
          </section>
        )}
        {investigation &&
          !investigation.evidence.length &&
          investigation.messages.length > 0 &&
          !running && (
            <p className="text-sm text-[var(--muted)]">
              No source evidence was retrieved. Treat explanations as unverified.
            </p>
          )}
        {investigation?.operations?.map((operation) => (
          <OperationCard
            key={operation.id}
            operation={operation}
            canOperate={canOperate && investigation.mode === 'operate'}
          />
        ))}
        {!!investigation?.progress.length && (
          <details open={running} className="text-xs">
            <summary className="cursor-pointer">
              Tool progress · {stateLabel(investigation.status)}
            </summary>
            <ol className="mt-2 space-y-1 border-l border-[var(--border)] pl-3">
              {investigation.progress.map((entry, i) => (
                <li key={entry.id ?? i}>{entry.message ?? entry.tool ?? entry.status}</li>
              ))}
            </ol>
          </details>
        )}
        <div role="status" aria-live="polite" className="text-xs text-[var(--muted)]">
          {running
            ? 'Working within the selected scope…'
            : investigation
              ? `${stateLabel(investigation.status)} · Last updated ${new Date(investigation.updatedAt).toLocaleString()}`
              : ''}
        </div>
        {investigation?.error && (
          <div
            role="alert"
            className="space-y-1 rounded border border-[var(--warning)] p-3 text-sm"
          >
            <strong>{stateLabel(investigation.error.state)}</strong>
            <p>{investigation.error.message}</p>
            <p>{investigation.error.recovery}</p>
            <p>
              Start a new investigation to explicitly choose a different provider. No paid provider
              is selected automatically.
            </p>
          </div>
        )}
        {error && (
          <div role="alert" className="space-y-2 text-sm text-[var(--danger)]">
            <p>{error.message}</p>
            <p>
              Reload saved progress before sending another request; accepted operations may still be
              running.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void detail.refetch();
                actions.send.reset();
                actions.create.reset();
                actions.cancel.reset();
              }}
            >
              Reload progress
            </Button>
          </div>
        )}
        {investigation?.usage && (
          <p className="text-xs text-[var(--muted)]">
            Usage: {investigation.usage.inputTokens} input / {investigation.usage.outputTokens}{' '}
            output tokens · Estimated cost ${investigation.usage.estimatedCostUsd.toFixed(4)}
          </p>
        )}
      </div>
      <form
        className="space-y-2 border-t border-[var(--border)] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input || context.prompt || '');
        }}
      >
        <label htmlFor="agent-question" className="text-sm font-medium">
          Ask K-Shui
        </label>
        <textarea
          id="agent-question"
          className="min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
          placeholder={context.prompt ?? 'Ask about the evidence or specify a change…'}
          value={input}
          maxLength={Math.min(8000, status.data.policy.maxInputChars)}
          onChange={(e) => setInput(e.target.value)}
          disabled={running}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted)]">
            {input.length}/{Math.min(8000, status.data.policy.maxInputChars)} · Limit $
            {status.data.policy.maxRunCostUsd}/run
          </span>
          {running && investigationId ? (
            <Button
              type="button"
              variant="outline"
              disabled={actions.cancel.isPending}
              onClick={() => actions.cancel.mutate(investigationId)}
            >
              <Square />
              {actions.cancel.isPending ? 'Cancelling…' : 'Cancel queued work'}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={
                !input.trim() ||
                !clusterId ||
                (!investigation && !selectedConnection) ||
                running ||
                !!detail.error ||
                !!actions.send.error
              }
            >
              <Send />
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
