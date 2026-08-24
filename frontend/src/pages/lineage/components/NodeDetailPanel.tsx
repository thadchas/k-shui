import { Link } from 'react-router';
import { ArrowUpRight, Crosshair, X } from 'lucide-react';
import { useLineageNodeDetail } from '@/api/hooks/lineage';
import type { LineageNodeFull } from '@/api/types';
import { formatRelative } from '@/lib/format';
import { lineageTypeStyle } from '@/components/LineageGraph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { InlineError } from '@/components/ui/error-state';
import { JsonViewer } from '@/components/ui/json-viewer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { lineageNodeLink } from '../lineageLib';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface NodeDetailPanelProps {
  cluster: string;
  node: LineageNodeFull;
  onClose: () => void;
  onFocus: (id: string) => void;
  onSelectId: (id: string) => void;
}

export function NodeDetailPanel({
  cluster,
  node,
  onClose,
  onFocus,
  onSelectId,
}: NodeDetailPanelProps) {
  const detail = useLineageNodeDetail(cluster, node.id);
  const style = lineageTypeStyle(node.type);
  const Icon = style.icon;
  const link = lineageNodeLink(node, cluster);
  const d = detail.data;

  return (
    <aside className="flex w-full min-w-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] lg:w-[380px]">
      <header className="flex items-start gap-2.5 border-b border-[var(--border)] p-4">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px]"
          style={{ background: `color-mix(in srgb, ${style.color} 16%, transparent)` }}
        >
          <Icon className="size-4" style={{ color: style.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={node.label}>
            {node.label}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" size="sm">
              {style.label}
            </Badge>
            {node.status ? <StatusPill status={node.status} /> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onFocus(node.id)}>
              <Crosshair /> Focus
            </Button>
            {link ? (
              <Button asChild size="sm" variant="outline">
                <Link to={link.to}>
                  {link.label} <ArrowUpRight />
                </Link>
              </Button>
            ) : null}
          </div>

          <Section title="Identity">
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 text-[var(--muted)]">Node id</span>
                <span className="min-w-0 flex-1 break-all font-mono text-2xs">{node.id}</span>
                <CopyButton value={node.id} tooltip="Copy node id" />
              </div>
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 text-[var(--muted)]">Namespace</span>
                <span className="min-w-0 flex-1 break-all font-mono text-2xs">
                  {node.namespace ?? '—'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-20 shrink-0 text-[var(--muted)]">Sources</span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {(node.sources ?? []).length === 0 ? (
                    <span className="text-2xs text-[var(--muted)]">—</span>
                  ) : (
                    (node.sources ?? []).map((s) => (
                      <Badge key={s} variant="outline" size="sm">
                        {s}
                      </Badge>
                    ))
                  )}
                </span>
              </div>
            </div>
          </Section>

          {detail.error ? (
            <InlineError error={detail.error} onRetry={() => void detail.refetch()} />
          ) : detail.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <>
              {(d?.upstream?.length ?? 0) > 0 ? (
                <Section title={`Upstream (${d?.upstream.length})`}>
                  <ul className="space-y-1">
                    {d?.upstream.map((id) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => onSelectId(id)}
                          className="w-full truncate rounded-[6px] px-2 py-1 text-left font-mono text-2xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                          title={id}
                        >
                          {id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {(d?.downstream?.length ?? 0) > 0 ? (
                <Section title={`Downstream (${d?.downstream.length})`}>
                  <ul className="space-y-1">
                    {d?.downstream.map((id) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => onSelectId(id)}
                          className="w-full truncate rounded-[6px] px-2 py-1 text-left font-mono text-2xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                          title={id}
                        >
                          {id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {(d?.latestRuns?.length ?? 0) > 0 ? (
                <Section title="Latest runs">
                  <div className="space-y-1.5">
                    {d?.latestRuns.slice(0, 8).map((run, i) => (
                      <div
                        key={run.id ?? i}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--border)] px-2.5 py-1.5"
                      >
                        <StatusPill status={run.state ?? 'unknown'} />
                        <span className="truncate font-mono text-2xs text-[var(--muted)]">
                          {run.startedAt ? formatRelative(run.startedAt) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {(d?.schemaFields?.length ?? 0) > 0 ? (
                <Section title="Schema">
                  <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                    {d?.schemaFields.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1.5 last:border-0"
                      >
                        <span className="truncate font-mono text-2xs">{f.name}</span>
                        <span className="shrink-0 text-2xs text-[var(--muted)]">
                          {f.type ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {d?.facets && Object.keys(d.facets).length > 0 ? (
                <Section title="Facets">
                  <JsonViewer value={d.facets} maxHeight={220} defaultExpandedDepth={1} />
                </Section>
              ) : null}

              {Object.keys(node.meta ?? {}).length > 0 ? (
                <Section title="Metadata">
                  <JsonViewer value={node.meta} maxHeight={220} defaultExpandedDepth={2} />
                </Section>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
