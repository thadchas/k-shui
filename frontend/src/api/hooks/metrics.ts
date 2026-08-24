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

/* ===========================================================================
 * Additions for the Metrics dashboards / explorer pages (appended only).
 * ======================================================================== */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DashboardDataResponse,
  DashboardSpec,
  DashboardSummaryFull,
  DashboardWriteRequest,
  MetricsStatusFull,
  PromRangeResponse,
  PromVectorResponse,
} from '@/api/types';

const metricsBase = (cluster: string) => `/clusters/${cluster}/metrics`;

export function useMetricsStatusFull(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.metricsStatus(cluster ?? ''),
    queryFn: () => api.get<MetricsStatusFull>(`${metricsBase(cluster!)}/status`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useDashboardList(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.dashboards(cluster ?? ''),
    queryFn: () => api.get<DashboardSummaryFull[]>(`${metricsBase(cluster!)}/dashboards`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useDashboardSpec(cluster: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: qk.dashboard(cluster ?? '', id ?? ''),
    queryFn: () => api.get<DashboardSpec>(`${metricsBase(cluster!)}/dashboards/${id}`),
    enabled: Boolean(cluster && id),
    retry: false,
  });
}

export function useDashboardPanelData(
  cluster: string | undefined,
  id: string | undefined,
  range: RangeParams,
  vars?: Record<string, string>,
) {
  const refetchInterval = useRefetchInterval();
  const varsParam = vars && Object.keys(vars).length > 0 ? JSON.stringify(vars) : undefined;
  return useQuery({
    queryKey: [...qk.dashboardData(cluster ?? '', id ?? '', range), varsParam ?? ''] as const,
    queryFn: () =>
      api.get<DashboardDataResponse>(`${metricsBase(cluster!)}/dashboards/${id}/data`, {
        ...range,
        vars: varsParam,
      }),
    enabled: Boolean(cluster && id),
    refetchInterval,
    retry: false,
  });
}

export function useCreateDashboard(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DashboardWriteRequest) =>
      api.post<DashboardSpec>(`${metricsBase(cluster)}/dashboards`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboards(cluster) }),
  });
}

export function useUpdateDashboard(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DashboardWriteRequest & { id: string }) =>
      api.put<DashboardSpec>(`${metricsBase(cluster)}/dashboards/${id}`, { id, ...body }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.dashboards(cluster) });
      void qc.invalidateQueries({ queryKey: qk.dashboard(cluster, vars.id) });
    },
  });
}

export function useDeleteDashboard(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${metricsBase(cluster)}/dashboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboards(cluster) }),
  });
}

export function useImportDashboard(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: Record<string, unknown>; id?: string }) =>
      api.post<DashboardSpec>(`${metricsBase(cluster)}/dashboards/import`, payload, { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboards(cluster) }),
  });
}

/** Raw Prometheus `query_range` (matrix) for the explorer. */
export function usePromRange(
  cluster: string | undefined,
  query: string,
  range: RangeParams,
  enabled = true,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.promQueryRange(cluster ?? '', query, range),
    queryFn: () =>
      api.get<PromRangeResponse>(`${metricsBase(cluster!)}/query_range`, { query, ...range }),
    enabled: Boolean(cluster && query) && enabled,
    refetchInterval,
    retry: false,
  });
}

/** Raw Prometheus instant `query` (vector) for the explorer's table view. */
export function usePromInstant(
  cluster: string | undefined,
  query: string,
  enabled = true,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.promQuery(cluster ?? '', query),
    queryFn: () => api.get<PromVectorResponse>(`${metricsBase(cluster!)}/query`, { query }),
    enabled: Boolean(cluster && query) && enabled,
    refetchInterval,
    retry: false,
  });
}

export function useMetricLabelValues(cluster: string | undefined, label: string) {
  return useQuery({
    queryKey: [...qk.metricsStatus(cluster ?? ''), 'labels', label] as const,
    queryFn: () => api.get<string[]>(`${metricsBase(cluster!)}/labels/${label}/values`),
    enabled: Boolean(cluster && label),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
