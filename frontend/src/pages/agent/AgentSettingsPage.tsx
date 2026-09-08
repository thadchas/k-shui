import { Link } from 'react-router';
import { useAgentActions, useAgentStatus } from '@/api/hooks/agent';
import { usePermissions } from '@/hooks/usePermissions';
import type { AgentConnection } from '@/api/agentTypes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { stateLabel } from '@/components/agent/agentUtils';

function ConnectionCard({
  connection,
  canTest,
}: {
  connection: AgentConnection;
  canTest: boolean;
}) {
  const { test } = useAgentActions();
  return (
    <article className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{connection.name}</h2>
        <Badge variant="outline">{connection.managed ? 'Administrator-managed' : 'Personal'}</Badge>
      </div>
      <p className="text-sm">
        {connection.provider} · <strong>{connection.model}</strong>
      </p>
      <Badge variant={connection.state === 'connected' ? 'success' : 'warning'}>
        {stateLabel(test.data?.state ?? connection.state)}
      </Badge>
      <dl className="space-y-1 text-xs text-[var(--muted)]">
        <div>
          Credential: {connection.credentialConfigured ? 'Configured on server' : 'Not configured'}
        </div>
        <div>Clusters: {connection.allowedClusters.join(', ')}</div>
      </dl>
      <p className="text-sm">{test.data?.recovery ?? connection.recovery}</p>
      <p className="text-xs text-[var(--muted)]">
        Connection test results are informational. They do not gate runs or guarantee current
        availability; a configured connection may be used before testing or after a failed test.
        {connection.testedAt && ` Last tested ${new Date(connection.testedAt).toLocaleString()}.`}
      </p>
      <Button
        variant="outline"
        disabled={!canTest || test.isPending}
        onClick={() => test.mutate(connection.id)}
      >
        {test.isPending ? 'Testing…' : 'Test connectivity and tool capability'}
      </Button>
      {!canTest && (
        <p className="text-xs text-[var(--muted)]">
          An administrator can test deployment-managed connections.
        </p>
      )}
      {test.data && (
        <p role="status" className="text-xs">
          Tool capability: {test.data.toolCapable ? 'Supported' : 'Not verified'} · Tested{' '}
          {new Date(test.data.testedAt).toLocaleString()}
        </p>
      )}
      {test.error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {test.error.message}
        </p>
      )}
    </article>
  );
}

export function AgentSettingsPage() {
  const status = useAgentStatus();
  const permissions = usePermissions();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link to="/settings" className="text-sm text-[var(--primary)] underline">
          App settings
        </Link>
        <h1 className="mt-3 text-xl font-semibold">AI connections and data policy</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Model connections authenticate inference. Every resource action uses the acting user’s
          existing K-Shui permissions.
        </p>
      </header>
      {status.isPending ? (
        <p role="status">Loading agent configuration…</p>
      ) : status.error ? (
        <div role="alert">
          <p>{status.error.message}</p>
          <Button onClick={() => void status.refetch()}>Retry</Button>
        </div>
      ) : (
        status.data && (
          <>
            <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-4">
              <h2 className="font-semibold">Deployment policy</h2>
              <Badge variant={status.data.enabled ? 'success' : 'secondary'}>
                {status.data.enabled ? 'Agent enabled' : 'Agent disabled'}
              </Badge>
              <p className="text-sm">
                Enable and configure the agent through deployment configuration. API keys stay in
                server-side environment secrets; they are never entered into browser storage or
                investigations.
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--muted)]">Acting user</dt>
                  <dd>{status.data.actingUser}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Available modes</dt>
                  <dd>{status.data.effectiveModes.map(stateLabel).join(', ') || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Data access</dt>
                  <dd>Metadata, metrics, redacted configuration and bounded error summaries</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Message payload access</dt>
                  <dd>
                    {status.data.policy.allowPayloads
                      ? 'Requires explicit bounded sample support'
                      : 'Prohibited by deployment policy'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Per-run limits</dt>
                  <dd>
                    {status.data.policy.maxToolCalls} tool calls ·{' '}
                    {status.data.policy.maxRunSeconds}s · {status.data.policy.maxOutputTokens}{' '}
                    output tokens
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Maximum estimated run cost</dt>
                  <dd>${status.data.policy.maxRunCostUsd}</dd>
                </div>
              </dl>
            </section>
            <p className="text-sm">
              Questions, conversation context, cluster metadata, redacted configuration and error
              summaries are sent to the configured OpenAI or Anthropic API. Provider retention
              policies and terms apply. Review your organization’s data-sharing policy before
              enabling the agent; do not include sensitive data in questions.
            </p>
            <section aria-label="AI connections" className="grid gap-4 sm:grid-cols-2">
              {status.data.connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  canTest={permissions.isAdmin && !permissions.loading}
                />
              ))}
              {!status.data.connections.length && (
                <p className="text-sm text-[var(--muted)]">
                  No connections configured. Add an OpenAI API or Anthropic API connection in
                  deployment configuration, including model, environment secret reference, pricing
                  and allowed clusters.
                </p>
              )}
            </section>
            <p className="text-sm text-[var(--muted)]">
              API usage is billed to the configured API account. Changing connections requires a new
              scoped investigation; there is no automatic paid-provider fallback. ChatGPT/Codex and
              Claude Code subscription runtimes are separate integrations and are not supported in
              this release.
            </p>
            <Link className="inline-block text-[var(--primary)] underline" to="/agent">
              Open K-Shui investigations
            </Link>
          </>
        )
      )}
    </div>
  );
}
