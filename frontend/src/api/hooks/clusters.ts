import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clusterScope, qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  ClusterDetail,
  ClusterHealth,
  ClusterSummary,
  ConfigEntry,
  ConfigUpdateRequest,
  KRaftQuorum,
  RangeParams,
  ReplicationFlow,
  ReplicationOverview,
  ReplicationResponse,
  SeriesResponse,
  UnhealthyPartitionsResponse,
} from '@/api/types';

export function useClusters() {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.clusters(),
    queryFn: () => api.get<ClusterSummary[]>('/clusters'),
    refetchInterval,
    staleTime: 5_000,
  });
}

export function useCluster(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.cluster(cluster ?? ''),
    queryFn: () => api.get<ClusterDetail>(`/clusters/${cluster}`),
    enabled: Boolean(cluster),
    refetchInterval,
  });
}

export function useClusterHealth(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.clusterHealth(cluster ?? ''),
    queryFn: () => api.get<ClusterHealth>(`/clusters/${cluster}/health`),
    enabled: Boolean(cluster),
    refetchInterval,
  });
}

export function useOverviewMetrics(cluster: string | undefined, range: RangeParams) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.clusterOverviewMetrics(cluster ?? '', range),
    queryFn: () => api.get<SeriesResponse>(`/clusters/${cluster}/overview/metrics`, { ...range }),
    enabled: Boolean(cluster),
    refetchInterval,
  });
}

export function useKRaftQuorum(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.kraftQuorum(cluster ?? ''),
    queryFn: () => api.get<KRaftQuorum>(`/clusters/${cluster}/kraft/quorum`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

/** Cluster-wide offline / under-replicated / non-preferred-leader partitions. */
export function useUnhealthyPartitions(cluster: string | undefined, enabled = true) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: [...clusterScope(cluster ?? ''), 'partitions-unhealthy'] as const,
    queryFn: () =>
      api.get<UnhealthyPartitionsResponse>(`/clusters/${cluster}/partitions/unhealthy`),
    enabled: Boolean(cluster) && enabled,
    refetchInterval,
  });
}

export function useClusterConfigs(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.clusterConfigs(cluster ?? ''),
    queryFn: () => api.get<ConfigEntry[]>(`/clusters/${cluster}/configs`),
    enabled: Boolean(cluster),
  });
}

export function useUpdateClusterConfigs(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigUpdateRequest) => api.put<void>(`/clusters/${cluster}/configs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clusterConfigs(cluster) }),
  });
}

export function useReplication(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.replication(cluster ?? ''),
    queryFn: () => api.get<ReplicationFlow[]>(`/clusters/${cluster}/replication`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useInvalidateCluster(cluster: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: clusterScope(cluster) });
}

/* -------------------------------------------------------------------------- *
 * Addition for the Replication page. `GET /clusters/{c}/replication` returns
 * either a bare flow array or an envelope; this hook normalises both.
 * -------------------------------------------------------------------------- */

export function useReplicationOverview(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: [...qk.replication(cluster ?? ''), 'overview'] as const,
    queryFn: async (): Promise<ReplicationOverview> => {
      const data = await api.get<ReplicationResponse>(`/clusters/${cluster}/replication`);
      if (Array.isArray(data)) {
        return { supported: true, detected: data.length > 0, flows: data };
      }
      return {
        supported: data?.supported ?? true,
        detected: data?.detected ?? (data?.flows?.length ?? 0) > 0,
        flows: data?.flows ?? [],
        links: data?.links,
        connectClusters: data?.connectClusters,
      };
    },
    enabled: Boolean(cluster),
    refetchInterval,
    retry: false,
  });
}
