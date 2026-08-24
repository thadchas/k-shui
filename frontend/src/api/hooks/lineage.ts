/** Stream lineage hooks — the graph page lands with the Governance agent. */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import type { LineageGraph, LineageNode, LineageNodeDetail } from '@/api/types';

export interface LineageGraphParams {
  focus?: string;
  depth?: number;
  sources?: string[];
}

export function useLineageGraph(cluster: string | undefined, params: LineageGraphParams = {}) {
  return useQuery({
    queryKey: qk.lineageGraph(cluster ?? '', params as Record<string, unknown>),
    queryFn: () =>
      api.get<LineageGraph>(`/clusters/${cluster}/lineage/graph`, {
        focus: params.focus,
        depth: params.depth,
        sources: params.sources,
      }),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useLineageNode(cluster: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: qk.lineageNode(cluster ?? '', id ?? ''),
    queryFn: () =>
      api.get<LineageNodeDetail>(`/clusters/${cluster}/lineage/nodes/${encodeURIComponent(id!)}`),
    enabled: Boolean(cluster && id),
    retry: false,
  });
}

export function useLineageSearch(cluster: string | undefined, q: string) {
  return useQuery({
    queryKey: qk.lineageSearch(cluster ?? '', q),
    queryFn: () => api.get<LineageNode[]>(`/clusters/${cluster}/lineage/search`, { q }),
    enabled: Boolean(cluster && q.length > 1),
    retry: false,
  });
}

export function useLineageNamespaces(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.lineageNamespaces(cluster ?? ''),
    queryFn: () => api.get<string[]>(`/clusters/${cluster}/lineage/namespaces`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

/* ===========================================================================
 * Additions for the lineage canvas (appended only).
 * ======================================================================== */
import type {
  LineageGraphFull,
  LineageNamespace,
  LineageNodeDetailFull,
  LineageSearchResponse,
  LineageSource,
} from '@/api/types';

export interface LineageQuery {
  focus?: string | null;
  depth?: number;
  sources?: LineageSource[];
}

export function useLineageGraphFull(cluster: string | undefined, query: LineageQuery = {}) {
  const { focus, depth = 3, sources } = query;
  return useQuery({
    queryKey: qk.lineageGraph(cluster ?? '', { focus: focus ?? null, depth, sources }),
    queryFn: () =>
      api.get<LineageGraphFull>(`/clusters/${cluster}/lineage/graph`, {
        focus: focus ?? undefined,
        depth,
        sources: sources && sources.length > 0 ? sources : undefined,
      }),
    enabled: Boolean(cluster),
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useLineageNodeDetail(cluster: string | undefined, id: string | null | undefined) {
  return useQuery({
    queryKey: qk.lineageNode(cluster ?? '', id ?? ''),
    queryFn: () =>
      api.get<LineageNodeDetailFull>(
        `/clusters/${cluster}/lineage/nodes/${encodeURIComponent(id!)}`,
      ),
    enabled: Boolean(cluster && id),
    retry: false,
  });
}

export function useLineageSearchHits(cluster: string | undefined, q: string) {
  return useQuery({
    queryKey: qk.lineageSearch(cluster ?? '', q),
    queryFn: () => api.get<LineageSearchResponse>(`/clusters/${cluster}/lineage/search`, { q }),
    enabled: Boolean(cluster) && q.trim().length > 1,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useLineageNamespaceList(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.lineageNamespaces(cluster ?? ''),
    queryFn: async () => {
      const raw = await api.get<(LineageNamespace | string)[]>(
        `/clusters/${cluster}/lineage/namespaces`,
      );
      return raw.map((n) => (typeof n === 'string' ? { name: n } : n));
    },
    enabled: Boolean(cluster),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
