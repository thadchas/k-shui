import { describe, expect, it } from 'vitest';
import type { LineageEdge, LineageNodeFull } from '@/api/types';
import {
  dependencyRows,
  directNeighbors,
  downstreamImpact,
  downstreamOf,
  focusNeighborhoodIds,
  lineageNodeLink,
  normalizeFocusId,
  shortNodeId,
  traverseLineage,
  upstreamOf,
} from './lineageLib';

function edge(id: string, source: string, target: string): LineageEdge {
  return { id, source, target, kind: 'produces' };
}

function node(id: string, type = 'topic'): LineageNodeFull {
  return { id, type, label: id, namespace: null, status: null, clusterId: null, meta: {} };
}

/* -------------------------------- fixtures -------------------------------- */

// A -> B -> C -> D
const CHAIN_EDGES: LineageEdge[] = [
  edge('e1', 'A', 'B'),
  edge('e2', 'B', 'C'),
  edge('e3', 'C', 'D'),
];

// diamond / fan-out: A -> B, A -> C, B -> D, C -> D
const DIAMOND_EDGES: LineageEdge[] = [
  edge('e1', 'A', 'B'),
  edge('e2', 'A', 'C'),
  edge('e3', 'B', 'D'),
  edge('e4', 'C', 'D'),
];

// cycle: A -> B -> C -> A, plus C -> D leaving the cycle
const CYCLE_EDGES: LineageEdge[] = [
  edge('e1', 'A', 'B'),
  edge('e2', 'B', 'C'),
  edge('e3', 'C', 'A'),
  edge('e4', 'C', 'D'),
];

/* ------------------------------- traversal -------------------------------- */

describe('traverseLineage', () => {
  it('walks a linear chain downstream with shortest hop distances', () => {
    const depths = traverseLineage('A', CHAIN_EDGES, 'downstream');
    expect(Object.fromEntries(depths)).toEqual({ B: 1, C: 2, D: 3 });
  });

  it('walks a linear chain upstream from the tail', () => {
    const depths = traverseLineage('D', CHAIN_EDGES, 'upstream');
    expect(Object.fromEntries(depths)).toEqual({ C: 1, B: 2, A: 3 });
  });

  it('respects a maxDepth bound', () => {
    const depths = traverseLineage('A', CHAIN_EDGES, 'downstream', 2);
    expect(Object.fromEntries(depths)).toEqual({ B: 1, C: 2 });
    expect(depths.has('D')).toBe(false);
  });

  it('merges fan-in/fan-out paths in a diamond to the shortest distance', () => {
    const downstream = traverseLineage('A', DIAMOND_EDGES, 'downstream');
    expect(Object.fromEntries(downstream)).toEqual({ B: 1, C: 1, D: 2 });

    const upstream = traverseLineage('D', DIAMOND_EDGES, 'upstream');
    expect(Object.fromEntries(upstream)).toEqual({ B: 1, C: 1, A: 2 });
  });

  it('tolerates cycles without looping forever, visiting each node once', () => {
    const downstream = traverseLineage('A', CYCLE_EDGES, 'downstream');
    // A -> B -> C -> A (back-edge ignored) and C -> D
    expect(Object.fromEntries(downstream)).toEqual({ B: 1, C: 2, D: 3 });
    expect(downstream.has('A')).toBe(false);
  });

  it('returns an empty map for a node with no edges in that direction', () => {
    expect(traverseLineage('D', CHAIN_EDGES, 'downstream').size).toBe(0);
    expect(traverseLineage('A', CHAIN_EDGES, 'upstream').size).toBe(0);
  });
});

describe('upstreamOf / downstreamOf', () => {
  it('are thin wrappers around traverseLineage', () => {
    expect(Object.fromEntries(downstreamOf('A', CHAIN_EDGES))).toEqual({ B: 1, C: 2, D: 3 });
    expect(Object.fromEntries(upstreamOf('D', CHAIN_EDGES))).toEqual({ C: 1, B: 2, A: 3 });
  });
});

/* ---------------------------- direct neighbours ---------------------------- */

describe('directNeighbors', () => {
  it('returns only one-hop neighbours, de-duplicated', () => {
    expect(directNeighbors('A', DIAMOND_EDGES, 'downstream')).toEqual(['B', 'C']);
    expect(directNeighbors('D', DIAMOND_EDGES, 'upstream')).toEqual(['B', 'C']);
  });

  it('handles a node with parallel edges to the same neighbour', () => {
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'A', 'B')];
    expect(directNeighbors('A', edges, 'downstream')).toEqual(['B']);
  });

  it('returns an empty array when there are no neighbours', () => {
    expect(directNeighbors('Z', CHAIN_EDGES, 'downstream')).toEqual([]);
  });
});

describe('focusNeighborhoodIds', () => {
  it('includes the focus node plus direct upstream and downstream neighbours only', () => {
    const ids = focusNeighborhoodIds('B', CHAIN_EDGES);
    expect(new Set(ids)).toEqual(new Set(['B', 'A', 'C']));
    expect(ids).not.toContain('D');
  });

  it('is just the focus id when it is isolated', () => {
    expect(focusNeighborhoodIds('Z', CHAIN_EDGES)).toEqual(['Z']);
  });
});

/* -------------------------------- impact path ------------------------------ */

describe('downstreamImpact', () => {
  it('captures the full downstream blast radius of a linear chain', () => {
    const impact = downstreamImpact('A', CHAIN_EDGES);
    expect(impact.nodeIds).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(impact.edgeIds).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('excludes upstream/unrelated nodes and edges', () => {
    const impact = downstreamImpact('B', CHAIN_EDGES);
    expect(impact.nodeIds).toEqual(new Set(['B', 'C', 'D']));
    expect(impact.edgeIds).toEqual(new Set(['e2', 'e3']));
  });

  it('includes both branches of a diamond fan-out', () => {
    const impact = downstreamImpact('A', DIAMOND_EDGES);
    expect(impact.nodeIds).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(impact.edgeIds).toEqual(new Set(['e1', 'e2', 'e3', 'e4']));
  });

  it('tolerates cycles and never marks a back-edge as forward impact', () => {
    const impact = downstreamImpact('A', CYCLE_EDGES);
    expect(impact.nodeIds).toEqual(new Set(['A', 'B', 'C', 'D']));
    // e3 (C -> A) is a back-edge (target depth 0 <= source depth 2) and must
    // not be included, otherwise the highlight would "loop" back visually.
    expect(impact.edgeIds).toEqual(new Set(['e1', 'e2', 'e4']));
  });

  it('respects a maxDepth bound', () => {
    const impact = downstreamImpact('A', CHAIN_EDGES, 1);
    expect(impact.nodeIds).toEqual(new Set(['A', 'B']));
    expect(impact.edgeIds).toEqual(new Set(['e1']));
  });

  it('is just the focus node with no edges when nothing is downstream', () => {
    const impact = downstreamImpact('D', CHAIN_EDGES);
    expect(impact.nodeIds).toEqual(new Set(['D']));
    expect(impact.edgeIds.size).toBe(0);
  });
});

/* ------------------------------ dependency list ----------------------------- */

describe('dependencyRows', () => {
  const nodes = ['A', 'B', 'C', 'D'].map((id) => node(id));

  it('lists upstream before downstream, ordered by depth then label', () => {
    const rows = dependencyRows('B', nodes, CHAIN_EDGES);
    expect(rows).toEqual([
      { id: 'A', label: 'A', type: 'topic', direction: 'upstream', depth: 1 },
      { id: 'C', label: 'C', type: 'topic', direction: 'downstream', depth: 1 },
      { id: 'D', label: 'D', type: 'topic', direction: 'downstream', depth: 2 },
    ]);
  });

  it('sorts same-direction/same-depth rows by label', () => {
    const rows = dependencyRows('A', nodes, DIAMOND_EDGES);
    const downstreamDepth1 = rows.filter((r) => r.direction === 'downstream' && r.depth === 1);
    expect(downstreamDepth1.map((r) => r.id)).toEqual(['B', 'C']);
  });

  it('falls back to a shortened id/"unknown" type when a node is missing from the node list', () => {
    const rows = dependencyRows('A', [node('A')], CHAIN_EDGES);
    const b = rows.find((r) => r.id === 'B');
    expect(b).toEqual({ id: 'B', label: 'B', type: 'unknown', direction: 'downstream', depth: 1 });
  });

  it('respects a maxDepth bound in both directions', () => {
    const rows = dependencyRows('B', nodes, CHAIN_EDGES, 1);
    expect(rows.map((r) => r.id)).toEqual(['A', 'C']);
  });

  it('returns an empty list for a fully isolated node', () => {
    expect(dependencyRows('Z', nodes, CHAIN_EDGES)).toEqual([]);
  });
});

/* ------------------------- pre-existing helpers (smoke) -------------------- */

describe('normalizeFocusId / shortNodeId / lineageNodeLink (smoke)', () => {
  it('still behave as before', () => {
    expect(normalizeFocusId(null, 'prod')).toBeNull();
    expect(normalizeFocusId('topic:orders.v1', 'prod')).toBe('topic:prod:orders.v1');
    expect(shortNodeId('short')).toBe('short');
    expect(lineageNodeLink(node('topic:prod:orders.v1'), 'prod')).toEqual({
      to: '/c/prod/topics/orders.v1',
      label: 'Open in Topics',
    });
  });
});
