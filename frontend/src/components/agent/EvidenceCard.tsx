import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import type { AgentEvidence } from '@/api/agentTypes';
import { Badge } from '@/components/ui/badge';
import { safeEvidenceHref, stateLabel } from './agentUtils';
import { useAgentClock } from './useAgentClock';
import { Button } from '@/components/ui/button';
import { useAgentActions } from '@/api/hooks/agent';

export function EvidenceCard({
  evidence,
  investigationId,
  running = false,
}: {
  evidence: AgentEvidence;
  investigationId?: string;
  running?: boolean;
}) {
  const now = useAgentClock();
  const { refreshEvidence } = useAgentActions();
  const age = now - Date.parse(evidence.observedAt);
  const historical =
    !Number.isFinite(age) || age >= 120_000 || age < 0 || evidence.status === 'stale';
  const href = safeEvidenceHref(evidence.href);
  const resourceLabel =
    typeof evidence.resource === 'string'
      ? evidence.resource
      : typeof evidence.resource?.name === 'string'
        ? evidence.resource.name
        : evidence.tool;
  return (
    <article
      id={`evidence-${evidence.id}`}
      tabIndex={-1}
      aria-label={`Evidence ${evidence.id}`}
      className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs focus:outline-2 focus:outline-[var(--primary)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>Observed evidence</strong>
        <Badge
          variant={
            !historical && (evidence.status === 'fresh' || evidence.status === 'available')
              ? 'success'
              : 'warning'
          }
        >
          {historical ? 'Historical snapshot' : 'Recent snapshot'}
        </Badge>
        <span>
          Retrieval:{' '}
          {['fresh', 'available'].includes(evidence.status)
            ? 'Successful'
            : stateLabel(evidence.status)}
        </span>
      </div>
      {href ? (
        <Link
          to={href}
          className="inline-flex max-w-full items-center gap-1 break-all text-[var(--primary)] underline"
        >
          <span>{resourceLabel}</span>
          <ExternalLink className="size-3 shrink-0" />
        </Link>
      ) : (
        <p className="break-all">{resourceLabel}</p>
      )}
      <p className="text-[var(--muted)]">
        Cluster {evidence.clusterId} · {evidence.tool}
        <br />
        <time dateTime={evidence.observedAt}>{new Date(evidence.observedAt).toLocaleString()}</time>
      </p>
      {historical && (
        <p className="text-[var(--muted)]">
          Saved observation; this does not establish current resource state.
        </p>
      )}
      {evidence.refreshedFrom && (
        <p>New observation from an explicit refresh. Earlier findings are unchanged.</p>
      )}
      {investigationId && (
        <Button
          size="sm"
          variant="outline"
          disabled={running || refreshEvidence.isPending}
          onClick={() => refreshEvidence.mutate({ id: investigationId, evidenceId: evidence.id })}
        >
          {refreshEvidence.isPending ? 'Refreshing…' : 'Refresh evidence'}
        </Button>
      )}
      {refreshEvidence.error && <p role="alert">{refreshEvidence.error.message}</p>}
      <details>
        <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
          Inspect source data
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono">
          {JSON.stringify(evidence.data, null, 2)}
        </pre>
      </details>
      {!!evidence.limitations?.length && (
        <div>
          <strong>Missing data / limitations</strong>
          <ul className="mt-1 list-disc pl-4">
            {evidence.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
