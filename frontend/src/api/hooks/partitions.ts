import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clusterScope } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  ElectLeadersRequest,
  ElectLeadersResponse,
  PartitionCapabilities,
  ReassignmentsResponse,
  ReassignPlanRequest,
  ReassignPlanResponse,
  ReassignRequest,
  ReassignResponse,
} from '@/api/types';

const base = (cluster: string | undefined) => `/clusters/${cluster}/partitions`;

export const partitionKeys = {
  capabilities: (cluster: string) =>
    [...clusterScope(cluster), 'partitions', 'capabilities'] as const,
  reassignments: (cluster: string) =>
    [...clusterScope(cluster), 'partitions', 'reassignments'] as const,
};

/** Which remediation APIs the backend's Kafka client can drive; the UI degrades on `false`. */
export function usePartitionCapabilities(cluster: string | undefined) {
  return useQuery({
    queryKey: partitionKeys.capabilities(cluster ?? ''),
    queryFn: () => api.get<PartitionCapabilities>(`${base(cluster)}/capabilities`),
    enabled: Boolean(cluster),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Reassignments currently in flight (adding / removing replicas). */
export function useReassignments(cluster: string | undefined, enabled = true) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: partitionKeys.reassignments(cluster ?? ''),
    queryFn: () => api.get<ReassignmentsResponse>(`${base(cluster)}/reassignments`),
    enabled: Boolean(cluster) && enabled,
    refetchInterval,
    retry: false,
  });
}

export function useElectLeaders(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ElectLeadersRequest) =>
      api.post<ElectLeadersResponse>(`${base(cluster)}/elect-leaders`, body),
    // Leaders changed cluster-wide: topic details, unhealthy list and broker counts all move.
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function useReassignPlan(cluster: string) {
  return useMutation({
    mutationFn: (body: ReassignPlanRequest) =>
      api.post<ReassignPlanResponse>(`${base(cluster)}/reassign/plan`, body),
  });
}

export function useReassign(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReassignRequest) =>
      api.post<ReassignResponse>(`${base(cluster)}/reassign`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}
