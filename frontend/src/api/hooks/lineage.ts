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
