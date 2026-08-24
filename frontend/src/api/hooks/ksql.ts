/** ksqlDB hooks — pages land with the Streaming agent. */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import type {
  KsqlCluster,
  KsqlHistoryEntry,
  KsqlQueryInfo,
  KsqlQueryRequest,
  KsqlStream,
  KsqlTable,
} from '@/api/types';

export function useKsqlClusters(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.ksqlClusters(cluster ?? ''),
    queryFn: () => api.get<KsqlCluster[]>(`/clusters/${cluster}/ksql`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useKsqlStreams(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlStreams(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlStream[]>(`/clusters/${cluster}/ksql/${k}/streams`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlTables(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlTables(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlTable[]>(`/clusters/${cluster}/ksql/${k}/tables`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlQueries(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlQueries(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlQueryInfo[]>(`/clusters/${cluster}/ksql/${k}/queries`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlHistory(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlHistory(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlHistoryEntry[]>(`/clusters/${cluster}/ksql/${k}/history`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlStatement(cluster: string, k: string) {
  return useMutation({
    mutationFn: (body: KsqlQueryRequest) =>
      api.post<unknown[]>(`/clusters/${cluster}/ksql/${k}/statement`, body),
  });
}

export function useTerminateKsqlQuery(cluster: string, k: string) {
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/clusters/${cluster}/ksql/${k}/queries/${encodeURIComponent(id)}`),
  });
}
