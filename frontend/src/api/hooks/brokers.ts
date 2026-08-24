import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  Broker,
  ConfigEntry,
  ConfigUpdateRequest,
  LogDir,
  RangeParams,
  SeriesResponse,
} from '@/api/types';

export function useBrokers(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.brokers(cluster ?? ''),
    queryFn: () => api.get<Broker[]>(`/clusters/${cluster}/brokers`),
    enabled: Boolean(cluster),
    refetchInterval,
  });
}

export function useBroker(cluster: string | undefined, id: string | number | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.broker(cluster ?? '', id ?? ''),
    queryFn: () => api.get<Broker>(`/clusters/${cluster}/brokers/${id}`),
    enabled: Boolean(cluster && id !== undefined),
    refetchInterval,
  });
}

export function useBrokerConfigs(cluster: string | undefined, id: string | number | undefined) {
  return useQuery({
    queryKey: qk.brokerConfigs(cluster ?? '', id ?? ''),
    queryFn: () => api.get<ConfigEntry[]>(`/clusters/${cluster}/brokers/${id}/configs`),
    enabled: Boolean(cluster && id !== undefined),
  });
}

export function useUpdateBrokerConfigs(cluster: string, id: string | number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigUpdateRequest) =>
      api.put<void>(`/clusters/${cluster}/brokers/${id}/configs`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.brokerConfigs(cluster, id) }),
  });
}

export function useBrokerLogDirs(cluster: string | undefined, id: string | number | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.brokerLogDirs(cluster ?? '', id ?? ''),
    queryFn: () => api.get<LogDir[]>(`/clusters/${cluster}/brokers/${id}/logdirs`),
    enabled: Boolean(cluster && id !== undefined),
    refetchInterval,
  });
}

export function useBrokerMetrics(
  cluster: string | undefined,
  id: string | number | undefined,
  range: RangeParams,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.brokerMetrics(cluster ?? '', id ?? '', range),
    queryFn: () =>
      api.get<SeriesResponse>(`/clusters/${cluster}/brokers/${id}/metrics`, { ...range }),
    enabled: Boolean(cluster && id !== undefined),
    refetchInterval,
    retry: false,
  });
}
