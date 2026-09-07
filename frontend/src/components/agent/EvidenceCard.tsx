import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import type { AgentEvidence } from '@/api/agentTypes';
import { Badge } from '@/components/ui/badge';
import { safeEvidenceHref, stateLabel } from './agentUtils';

export function EvidenceCard({ evidence }: { evidence: AgentEvidence }) {
  const href = safeEvidenceHref(evidence.href);
  const resourceLabel =
    typeof evidence.resource === 'string'
      ? evidence.resource
      : typeof evidence.resource?.name === 'string'
        ? evidence.resource.name
        : evidence.tool;
  return (
    <article className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Observed evidence</strong>
        <Badge
          variant={
            evidence.status === 'fresh' || evidence.status === 'available' ? 'success' : 'warning'
          }
        >
          {stateLabel(evidence.status)}
        </Badge>
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
