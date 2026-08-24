import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import type {
  AlertComponent,
  AlertAction,
  AlertHistoryEntry,
  AlertMetricCatalog,
  AlertSummary,
  AlertTrigger,
  Page,
} from '@/api/types';

export interface AlertHistoryQuery {
  status?: 'firing' | 'resolved';
  component?: AlertComponent;
  clusterId?: string;
  since?: string;
  page?: number;
  perPage?: number;
}

/** Topbar bell — degrades silently when the alerts router is not deployed. */
export function useAlertSummary(enabled = true) {
  return useQuery({
    queryKey: qk.alertSummary(),
    queryFn: () => api.get<AlertSummary>('/alerts/summary'),
    enabled,
    retry: false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useAlertHistory(query: AlertHistoryQuery = {}) {
  return useQuery({
    queryKey: qk.alertHistory(query as Record<string, unknown>),
    queryFn: () =>
      api.get<Page<AlertHistoryEntry> | AlertHistoryEntry[]>('/alerts/history', { ...query }),
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useAlertTriggers() {
  return useQuery({
    queryKey: qk.alertTriggers(),
    queryFn: () => api.get<AlertTrigger[]>('/alerts/triggers'),
    retry: false,
  });
}

export function useAlertActions() {
  return useQuery({
    queryKey: qk.alertActions(),
    queryFn: () => api.get<AlertAction[]>('/alerts/actions'),
    retry: false,
  });
}

export function useAlertMetricCatalog() {
  return useQuery({
    queryKey: qk.alertMetrics(),
    queryFn: () => api.get<AlertMetricCatalog>('/alerts/metrics'),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/alerts/history/${id}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}
