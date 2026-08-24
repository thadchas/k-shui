import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { clusterScope, qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  AddPartitionsRequest,
  CloneTopicRequest,
  ConfigEntry,
  ConfigUpdateRequest,
  CreateTopicRequest,
  Page,
  PurgeTopicRequest,
  RangeParams,
  SeriesResponse,
  TopicConsumer,
  TopicDetail,
  TopicListQuery,
  TopicSchemaInfo,
  TopicSummary,
} from '@/api/types';

export function useTopics(cluster: string | undefined, query: TopicListQuery) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.topics(cluster ?? '', query),
    queryFn: () =>
      api.get<Page<TopicSummary>>(`/clusters/${cluster}/topics`, {
        search: query.search,
        showInternal: query.showInternal,
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

export function useTopic(cluster: string | undefined, topic: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.topic(cluster ?? '', topic ?? ''),
    queryFn: () =>
      api.get<TopicDetail>(`/clusters/${cluster}/topics/${encodeURIComponent(topic!)}`),
    enabled: Boolean(cluster && topic),
    refetchInterval,
  });
}

export function useTopicConfigs(cluster: string | undefined, topic: string | undefined) {
  return useQuery({
    queryKey: qk.topicConfigs(cluster ?? '', topic ?? ''),
    queryFn: () =>
      api.get<ConfigEntry[]>(`/clusters/${cluster}/topics/${encodeURIComponent(topic!)}/configs`),
    enabled: Boolean(cluster && topic),
  });
}

export function useTopicConsumers(cluster: string | undefined, topic: string | undefined) {
  return useQuery({
    queryKey: qk.topicConsumers(cluster ?? '', topic ?? ''),
    queryFn: () =>
      api.get<TopicConsumer[]>(
        `/clusters/${cluster}/topics/${encodeURIComponent(topic!)}/consumers`,
      ),
    enabled: Boolean(cluster && topic),
  });
}

export function useTopicSchema(
  cluster: string | undefined,
  topic: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.topicSchema(cluster ?? '', topic ?? ''),
    queryFn: () =>
      api.get<TopicSchemaInfo>(`/clusters/${cluster}/topics/${encodeURIComponent(topic!)}/schema`),
    enabled: Boolean(cluster && topic) && enabled,
    retry: false,
  });
}

export function useTopicMetrics(
  cluster: string | undefined,
  topic: string | undefined,
  range: RangeParams,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.topicMetrics(cluster ?? '', topic ?? '', range),
    queryFn: () =>
      api.get<SeriesResponse>(`/clusters/${cluster}/topics/${encodeURIComponent(topic!)}/metrics`, {
        ...range,
      }),
    enabled: Boolean(cluster && topic),
    refetchInterval,
    retry: false,
  });
}

/* ------------------------------- mutations -------------------------------- */

export function useCreateTopic(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTopicRequest) =>
      api.post<TopicSummary>(`/clusters/${cluster}/topics`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function useDeleteTopic(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topic: string) =>
      api.delete<void>(`/clusters/${cluster}/topics/${encodeURIComponent(topic)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function useUpdateTopicConfigs(cluster: string, topic: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigUpdateRequest) =>
      api.put<void>(`/clusters/${cluster}/topics/${encodeURIComponent(topic)}/configs`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.topicConfigs(cluster, topic) });
      void qc.invalidateQueries({ queryKey: qk.topic(cluster, topic) });
    },
  });
}

export function useAddPartitions(cluster: string, topic: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddPartitionsRequest) =>
      api.post<void>(`/clusters/${cluster}/topics/${encodeURIComponent(topic)}/partitions`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function usePurgeTopic(cluster: string, topic: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: PurgeTopicRequest) =>
      api.post<void>(`/clusters/${cluster}/topics/${encodeURIComponent(topic)}/purge`, body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}

export function useCloneTopic(cluster: string, topic: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CloneTopicRequest) =>
      api.post<TopicSummary>(
        `/clusters/${cluster}/topics/${encodeURIComponent(topic)}/clone`,
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: clusterScope(cluster) }),
  });
}
