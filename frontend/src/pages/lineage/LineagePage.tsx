import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, GitBranch, Search, X } from 'lucide-react';
import { useLineageGraphFull, useLineageSearchHits } from '@/api/hooks/lineage';
import type { LineageNodeFull, LineageSource } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { LINEAGE_TYPES, LineageGraphCanvas, lineageTypeStyle } from '@/components/LineageGraph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { ALL_SOURCES, LINEAGE_SOURCES, normalizeFocusId } from './lineageLib';

export function LineagePage() {
  const cluster = useClusterId();
  const [params, setParams] = useSearchParams();

  const focusParam = normalizeFocusId(params.get('focus'), cluster);
  const [depth, setDepth] = useState(Number(params.get('depth')) || 3);
  const [sources, setSources] = useState<LineageSource[]>(ALL_SOURCES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 250);

  const graph = useLineageGraphFull(cluster, {
    focus: focusParam,
    depth,
    sources: sources.length === ALL_SOURCES.length ? undefined : sources,
  });
  const hits = useLineageSearchHits(cluster, debounced);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);

  const selected = useMemo<LineageNodeFull | null>(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [nodes]);

  const setFocus = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set('focus', id);
      else next.delete('focus');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const toggleSource = (value: LineageSource) =>
    setSources((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );

  const searchOptions = useMemo(
    () =>
      (hits.data?.results ?? []).map((r) => ({
        label: r.name,
        value: r.id,
        description: `${r.type}${r.namespace ? ` · ${r.namespace}` : ''}`,
      })),
    [hits.data],
  );

  const focusedNode = focusParam ? nodes.find((n) => n.id === focusParam) : undefined;

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[560px] flex-col gap-4">
      <PageHeader
        className="mb-0"
        title="Stream lineage"
        description="How data moves between topics, connectors, jobs and consumers."
        meta={
          graph.data ? (
            <Badge variant="secondary">
              {nodes.length} nodes · {edges.length} edges
            </Badge>
          ) : null
        }
        actions={<RefreshPicker onRefresh={() => void graph.refetch()} refreshing={graph.isFetching} />}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
        {/* toolbar */}
        <div className="hidden w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[var(--border)] p-4 lg:flex">
          <div className="space-y-1.5">
            <Label>Search</Label>
            <Combobox
              className="w-full"
              options={searchOptions}
              value={null}
              onValueChange={(id) => {
                if (!id) return;
                setSelectedId(id);
                setFocus(id);
              }}
              placeholder="Find a node…"
              searchPlaceholder="Search lineage…"
              emptyText={
                search.length < 2 ? 'Type to search' : hits.isFetching ? 'Searching…' : 'No matches'
              }
              onSearchChange={setSearch}
              loading={hits.isFetching}
            />
          </div>

          <div className="space-y-2">
            <Label>Sources</Label>
            <div className="space-y-1.5">
              {LINEAGE_SOURCES.map((s) => (
                <Tooltip key={s.value} content={s.hint} side="right">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={sources.includes(s.value)}
                      onCheckedChange={() => toggleSource(s.value)}
                      aria-label={s.label}
                    />
                    {s.label}
                  </label>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="lineage-depth">Depth</Label>
              <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">{depth}</span>
            </div>
            <input
              id="lineage-depth"
              type="range"
              min={1}
              max={6}
              step={1}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
              disabled={!focusParam}
            />
            <p className="text-2xs text-[var(--muted)]">
              {focusParam ? 'Hops from the focused node.' : 'Focus a node to limit depth.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Focus</Label>
            {focusParam ? (
              <div className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-2xs" title={focusParam}>
                  {focusedNode?.label ?? focusParam}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear focus"
                  onClick={() => setFocus(null)}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <p className="text-2xs text-[var(--muted)]">
                Showing the whole graph. Select a node and press Focus to zoom in.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Legend</Label>
            <div className="space-y-1">
              {Object.entries(LINEAGE_TYPES).map(([type, style]) => {
                const count = typeCounts.get(type) ?? 0;
                return (
                  <div
                    key={type}
                    className="flex items-center gap-2 text-2xs"
                    style={{ opacity: count === 0 ? 0.45 : 1 }}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: style.color }}
                    />
                    <span className="flex-1 truncate text-[var(--muted)]">{style.label}</span>
                    <span className="font-mono tabular-nums text-[var(--muted)]">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* canvas */}
        <div className="relative min-w-0 flex-1">
          {graph.error ? (
            <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
          ) : graph.isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-[420px] w-full" />
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title={focusParam ? 'Nothing connected here' : 'No lineage yet'}
              description={
                focusParam
                  ? 'This node has no lineage edges at the selected depth or source filters.'
                  : 'Lineage is derived from Marquez (OpenLineage), Kafka Connect, Flink, ksqlDB and consumer groups. Configure at least one to populate this graph.'
              }
              action={
                focusParam ? (
                  <Button variant="outline" onClick={() => setFocus(null)}>
                    Show whole graph
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <Link to={`/c/${cluster}/settings`}>
                      Cluster settings <ArrowUpRight />
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <LineageGraphCanvas
              nodes={nodes}
              edges={edges}
              focus={focusParam}
              selectedId={selectedId}
              onSelect={(node) => setSelectedId(node?.id ?? null)}
              fitViewKey={`${focusParam ?? ''}:${depth}:${sources.join(',')}`}
            />
          )}

          {/* mobile search */}
          <div className="absolute left-3 top-3 z-10 lg:hidden">
            <Card className="flex items-center gap-2 px-2 py-1.5">
              <Search className="size-3.5 text-[var(--muted)]" />
              <span className="text-2xs text-[var(--muted)]">
                {nodes.length} nodes · {edges.length} edges
              </span>
            </Card>
          </div>
        </div>

        {/* details */}
        {selected ? (
          <NodeDetailPanel
            cluster={cluster}
            node={selected}
            onClose={() => setSelectedId(null)}
            onFocus={(id) => {
              setFocus(id);
              setSelectedId(id);
            }}
            onSelectId={(id) => {
              const known = nodes.find((n) => n.id === id);
              if (known) setSelectedId(id);
              else {
                setFocus(id);
                setSelectedId(id);
              }
            }}
          />
        ) : null}
      </div>

      <p className="text-2xs text-[var(--muted)]">
        Node colours follow the type legend; animated edges show active flows.{' '}
        {selected ? (
          <span className="font-mono">{lineageTypeStyle(selected.type).label} selected</span>
        ) : (
          'Click a node for details.'
        )}
      </p>
    </div>
  );
}

export default LineagePage;
