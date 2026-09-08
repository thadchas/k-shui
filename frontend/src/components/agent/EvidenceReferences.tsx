import type { AgentEvidence } from '@/api/agentTypes';

/** Only server-validated IDs present in this investigation become navigable citations. */
export function EvidenceReferences({
  content,
  evidenceIds = [],
  evidence,
}: {
  content: string;
  evidenceIds?: string[];
  evidence: AgentEvidence[];
}) {
  return content.split(/(\[evidence:[a-zA-Z0-9_-]+\])/g).map((part, index) => {
    const id = /^\[evidence:([a-zA-Z0-9_-]+)\]$/.exec(part)?.[1];
    const source = id && evidenceIds.includes(id) ? evidence.find((e) => e.id === id) : undefined;
    if (!id) return part;
    if (!source)
      return (
        <span key={index} className="text-[var(--muted)]">
          [Source unavailable]
        </span>
      );
    return (
      <button
        key={index}
        className="rounded text-[var(--primary)] underline focus-visible:outline-2"
        title={`${source.tool} · ${source.clusterId} · ${source.observedAt}`}
        onClick={() => {
          const card = document.getElementById(`evidence-${source.id}`);
          const details = card?.querySelector('details');
          if (details) details.open = true;
          card?.focus();
          card?.scrollIntoView({ block: 'nearest' });
        }}
      >
        [Evidence · {new Date(source.observedAt).toLocaleString()}]
      </button>
    );
  });
}
