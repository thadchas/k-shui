import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clusterScope, qk, type ConsumerGroupsPageQuery } from '@/api/keys';
import { downloadBlob } from '@/lib/utils';
import { useRefetchInterval } from '@/stores/ui';
import type {
  ConsumerGroupDetail,
  ConsumerGroupSummary,
  Page,
  RangeParams,
  ResetOffsetsRequest,
  ResetOffsetsResult,
  SeriesResponse,
  ShareGroupsResponse,
} from '@/api/types';

export function useConsumerGroups(
  cluster: string | undefined,
  query: { search?: string; state?: string } = {},
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.consumerGroups(cluster ?? '', query),
    queryFn: () =>
      api.get<ConsumerGroupSummary[]>(`/clusters/${cluster}/consumer-groups`, {
        search: query.search,
        state: query.state,
      }),
    enabled: Boolean(cluster),
    refetchInterval,
    placeholderData: (prev) => prev,
  });
}

/** Server-paginated variant (`page` triggers the `{items,total,page,perPage}` envelope). */
export function useConsumerGroupsPage(cluster: string | undefined, query: ConsumerGroupsPageQuery) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.consumerGroupsPage(cluster ?? '', query),
    queryFn: () =>
      api.get<Page<ConsumerGroupSummary>>(`/clusters/${cluster}/consumer-groups`, {
        search: query.search,
        state: query.state,
        page: query.page,
        perPage: query.perPage,
        sort: query.sort,
        order: query.order,
      }),
    enabled: Boolean(cluster),
    refetchInterval,
    placeholderData: (prev) => prev,
  });
}

export function useConsumerGroup(cluster: string | undefined, group: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.consumerGroup(cluster ?? '', group ?? ''),
    queryFn: () =>
      api.get<ConsumerGroupDetail>(
        `/clusters/${cluster}/consumer-groups/${encodeURIComponent(group!)}`,
      ),
    enabled: Boolean(cluster && group),
    refetchInterval,
  });
}

export function useConsumerGroupLagHistory(
  cluster: string | undefined,
  group: string | undefined,
  range: RangeParams,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.consumerGroupLagHistory(cluster ?? '', group ?? '', range),
    queryFn: () =>
      api.get<SeriesResponse>(
        `/clusters/${cluster}/consumer-groups/${encodeURIComponent(group!)}/lag-history`,
        { ...range },
      ),
    enabled: Boolean(cluster && group),
    refetchInterval,
    retry: false,
  });
}

export function useDeleteConsumerGroup(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group: string) =>
      api.delete<void>(`/clusters/${cluster}/consumer-groups/${encodeURIComponent(group)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function useResetOffsets(cluster: string, group: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ResetOffsetsRequest) =>
      api.post<ResetOffsetsResult[]>(
        `/clusters/${cluster}/consumer-groups/${encodeURIComponent(group)}/offsets/reset`,
        body,
      ),
    onSuccess: (_data, variables) => {
      if (!variables.dryRun) void qc.invalidateQueries({ queryKey: clusterScope(cluster) });
    },
  });
}

export function useDeleteGroupOffsets(cluster: string, group: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topic: string) =>
      api.delete<void>(
        `/clusters/${cluster}/consumer-groups/${encodeURIComponent(group)}/offsets`,
        { topic },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.consumerGroup(cluster, group) }),
  });
}

export function useExportConsumerGroups(cluster: string) {
  return useMutation({
    mutationFn: async () => {
      const { blob, filename } = await api.download(
        `/clusters/${cluster}/consumer-groups/export.csv`,
      );
      downloadBlob(blob, filename ?? `${cluster}-consumer-groups.csv`);
    },
  });
}

export function useShareGroups(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.shareGroups(cluster ?? ''),
    queryFn: () => api.get<ShareGroupsResponse>(`/clusters/${cluster}/share-groups`),
    enabled: Boolean(cluster),
    refetchInterval,
    retry: false,
  });
}
