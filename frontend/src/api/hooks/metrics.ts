/** Prometheus-backed dashboards — pages land with the Observability agent. */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  Dashboard,
  DashboardData,
  DashboardSummary,
  MetricCatalogEntry,
  MetricsStatus,
  PromInstantResult,
  RangeParams,
  SeriesResponse,
} from '@/api/types';

export function useMetricsStatus(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.metricsStatus(cluster ?? ''),
    queryFn: () => api.get<MetricsStatus>(`/clusters/${cluster}/metrics/status`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useDashboards(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.dashboards(cluster ?? ''),
    queryFn: () => api.get<DashboardSummary[]>(`/clusters/${cluster}/metrics/dashboards`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useDashboard(cluster: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: qk.dashboard(cluster ?? '', id ?? ''),
    queryFn: () => api.get<Dashboard>(`/clusters/${cluster}/metrics/dashboards/${id}`),
    enabled: Boolean(cluster && id),
    retry: false,
  });
}

export function useDashboardData(
  cluster: string | undefined,
  id: string | undefined,
  range: RangeParams,
  vars?: Record<string, string>,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.dashboardData(cluster ?? '', id ?? '', range),
    queryFn: () =>
      api.get<DashboardData>(`/clusters/${cluster}/metrics/dashboards/${id}/data`, {
        ...range,
        ...(vars ?? {}),
      }),
    enabled: Boolean(cluster && id),
    refetchInterval,
    retry: false,
  });
}

export function useMetricCatalog(cluster: string | undefined, search?: string) {
  return useQuery({
    queryKey: qk.metricsCatalog(cluster ?? '', search),
    queryFn: () =>
      api.get<MetricCatalogEntry[]>(`/clusters/${cluster}/metrics/catalog`, { search }),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function usePromQuery(cluster: string | undefined, query: string, time?: string) {
  return useQuery({
    queryKey: qk.promQuery(cluster ?? '', query, time),
    queryFn: () =>
      api.get<PromInstantResult>(`/clusters/${cluster}/metrics/query`, { query, time }),
    enabled: Boolean(cluster && query),
    retry: false,
  });
}

export function usePromQueryRange(cluster: string | undefined, query: string, range: RangeParams) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.promQueryRange(cluster ?? '', query, range),
    queryFn: () =>
      api.get<SeriesResponse>(`/clusters/${cluster}/metrics/query_range`, { query, ...range }),
    enabled: Boolean(cluster && query),
    refetchInterval,
    retry: false,
  });
}
