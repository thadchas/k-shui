import type { LineageEdge, LineageNodeFull, LineageSource } from '@/api/types';

export const LINEAGE_SOURCES: { label: string; value: LineageSource; hint: string }[] = [
  { label: 'Marquez', value: 'marquez', hint: 'OpenLineage jobs, datasets and runs' },
  { label: 'Connect', value: 'connect', hint: 'Connector → topic edges' },
  { label: 'Flink', value: 'flink', hint: 'Flink jobs and their topics' },
  { label: 'ksqlDB', value: 'ksql', hint: 'ksqlDB streams and queries' },
  { label: 'Consumers', value: 'consumers', hint: 'Consumer group → topic edges' },
];

export const ALL_SOURCES: LineageSource[] = LINEAGE_SOURCES.map((s) => s.value);

/**
 * Node ids are `type:cluster[:scope]:name`. Rewrite loose ids such as
 * `topic:orders.v1` (used by cross-page deep links) into the canonical form.
 */
export function normalizeFocusId(focus: string | null, cluster: string): string | null {
  if (!focus) return null;
  const parts = focus.split(':');
  if (parts.length < 2) return focus;
  if (parts[1] === cluster) return focus;
  return `${parts[0]}:${cluster}:${parts.slice(1).join(':')}`;
}

/** Deep link into the feature page that owns this lineage node, if any. */
export function lineageNodeLink(
  node: LineageNodeFull,
  cluster: string,
): { to: string; label: string } | null {
  const parts = node.id.split(':');
  const name = parts.slice(2).join(':');
  switch (node.type) {
    case 'topic':
      return name
        ? { to: `/c/${cluster}/topics/${encodeURIComponent(name)}`, label: 'Open in Topics' }
        : null;
    case 'connector': {
      const kc = parts[2];
      const connector = parts.slice(3).join(':');
      return kc && connector
        ? {
            to: `/c/${cluster}/connect/${encodeURIComponent(kc)}/connectors/${encodeURIComponent(
              connector,
            )}`,
            label: 'Open in Connect',
          }
        : { to: `/c/${cluster}/connect`, label: 'Open in Connect' };
    }
    case 'flinkJob': {
      const fc = parts[2];
      const jid = parts.slice(3).join(':');
      return fc && jid
        ? {
            to: `/c/${cluster}/flink/${encodeURIComponent(fc)}/jobs/${jid}`,
            label: 'Open in Flink',
          }
        : { to: `/c/${cluster}/flink`, label: 'Open in Flink' };
    }
    case 'consumerGroup':
      return name
        ? { to: `/c/${cluster}/consumers/${encodeURIComponent(name)}`, label: 'Open in Consumers' }
        : null;
    case 'ksqlQuery':
      return { to: `/c/${cluster}/ksql`, label: 'Open in ksqlDB' };
    case 'schema':
      return name
        ? { to: `/c/${cluster}/schemas/${encodeURIComponent(name)}`, label: 'Open in Schemas' }
        : null;
    default:
      return null;
  }
}

export function shortNodeId(id: string, max = 40): string {
  return id.length > max ? `…${id.slice(id.length - max)}` : id;
}

/* ------------------------------ graph traversal ---------------------------- */
/**
 * Pure BFS-based helpers over a lineage edge list. Kept dependency-free (no
 * React, no xyflow, no dagre) so they can drive both the canvas emphasis
 * styling and the dependency-list view without duplicating traversal logic.
 */

export type LineageDirection = 'upstream' | 'downstream';

export interface DependencyRow {
  id: string;
  label: string;
  type: string;
  direction: LineageDirection;
  depth: number;
}

export interface ImpactPath {
  /** Focus node plus every downstream node reachable within the depth bound. */
  nodeIds: Set<string>;
  /** Edges that carry the impact forward (source depth = target depth - 1). */
  edgeIds: Set<string>;
}

interface Adjacency {
  /** source id -> target ids ("downstream" direction) */
  outgoing: Map<string, string[]>;
  /** target id -> source ids ("upstream" direction) */
  incoming: Map<string, string[]>;
}

function buildAdjacency(edges: LineageEdge[]): Adjacency {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  return { outgoing, incoming };
}

/**
 * Breadth-first walk from `focusId` following edges in the given direction,
 * bounded by `maxDepth` hops. Cycle-tolerant: each node is visited once, so a
 * cycle back to an already-seen node (including the focus itself) is a no-op
 * rather than an infinite loop. Returns reachable node id -> shortest hop
 * distance from the focus (the focus itself is excluded from the result).
 */
export function traverseLineage(
  focusId: string,
  edges: LineageEdge[],
  direction: LineageDirection,
  maxDepth: number = Infinity,
): Map<string, number> {
  const { outgoing, incoming } = buildAdjacency(edges);
  const adjacency = direction === 'downstream' ? outgoing : incoming;

  const depths = new Map<string, number>();
  const seen = new Set<string>([focusId]);
  const queue: [string, number][] = [[focusId, 0]];

  while (queue.length > 0) {
    const [id, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      depths.set(next, depth + 1);
      queue.push([next, depth + 1]);
    }
  }

  return depths;
}

export function upstreamOf(
  focusId: string,
  edges: LineageEdge[],
  maxDepth: number = Infinity,
): Map<string, number> {
  return traverseLineage(focusId, edges, 'upstream', maxDepth);
}

export function downstreamOf(
  focusId: string,
  edges: LineageEdge[],
  maxDepth: number = Infinity,
): Map<string, number> {
  return traverseLineage(focusId, edges, 'downstream', maxDepth);
}

/** Direct (one-hop) neighbours of `focusId` in the given direction, de-duped. */
export function directNeighbors(
  focusId: string,
  edges: LineageEdge[],
  direction: LineageDirection,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of edges) {
    const id =
      direction === 'downstream'
        ? e.source === focusId
          ? e.target
          : null
        : e.target === focusId
          ? e.source
          : null;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Focus node plus its direct upstream/downstream neighbours — used to size a readable initial viewport. */
export function focusNeighborhoodIds(focusId: string, edges: LineageEdge[]): string[] {
  const ids = new Set<string>([
    focusId,
    ...directNeighbors(focusId, edges, 'upstream'),
    ...directNeighbors(focusId, edges, 'downstream'),
  ]);
  return Array.from(ids);
}

/**
 * All downstream nodes/edges reachable from `focusId` — the "blast radius" of
 * a change to the focused resource. Edges are included only when they carry
 * the impact strictly forward (`target depth === source depth + 1`), which
 * naturally excludes back-edges that would otherwise re-highlight a cycle.
 */
export function downstreamImpact(
  focusId: string,
  edges: LineageEdge[],
  maxDepth: number = Infinity,
): ImpactPath {
  const downstream = traverseLineage(focusId, edges, 'downstream', maxDepth);
  const depthOf = new Map<string, number>([[focusId, 0], ...downstream]);
  const nodeIds = new Set(depthOf.keys());

  const edgeIds = new Set<string>();
  for (const e of edges) {
    const sourceDepth = depthOf.get(e.source);
    const targetDepth = depthOf.get(e.target);
    if (sourceDepth !== undefined && targetDepth !== undefined && targetDepth === sourceDepth + 1) {
      edgeIds.add(e.id);
    }
  }

  return { nodeIds, edgeIds };
}

/**
 * Flat, sortable list of every upstream/downstream dependency of `focusId` —
 * the data model behind the dependency-list view (an alternative to reading
 * the graph canvas).
 */
export function dependencyRows(
  focusId: string,
  nodes: LineageNodeFull[],
  edges: LineageEdge[],
  maxDepth: number = Infinity,
): DependencyRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const toRows = (depths: Map<string, number>, direction: LineageDirection): DependencyRow[] =>
    Array.from(depths, ([id, depth]) => ({
      id,
      label: byId.get(id)?.label ?? shortNodeId(id),
      type: byId.get(id)?.type ?? 'unknown',
      direction,
      depth,
    }));

  const rows = [
    ...toRows(upstreamOf(focusId, edges, maxDepth), 'upstream'),
    ...toRows(downstreamOf(focusId, edges, maxDepth), 'downstream'),
  ];

  rows.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'upstream' ? -1 : 1;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.label.localeCompare(b.label);
  });

  return rows;
}
