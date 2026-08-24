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

/* ===========================================================================
 * Additions for the alerts pages (appended only).
 * ======================================================================== */
import { useEffect, useRef } from 'react';
import { sse } from '@/api/client';
import type {
  AlertActionTestResult,
  AlertActionWrite,
  AlertTriggerWrite,
  ServerEvent,
} from '@/api/types';

/* --------------------------------- triggers ------------------------------- */

export function useAlertTrigger(id: string | undefined) {
  return useQuery({
    queryKey: qk.alertTrigger(id ?? ''),
    queryFn: () => api.get<AlertTrigger>(`/alerts/triggers/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreateAlertTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AlertTriggerWrite) => api.post<AlertTrigger>('/alerts/triggers', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useUpdateAlertTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AlertTriggerWrite & { id: string }) =>
      api.put<AlertTrigger>(`/alerts/triggers/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useDeleteAlertTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/alerts/triggers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useToggleAlertTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.post<void>(`/alerts/triggers/${id}/${enabled ? 'enable' : 'disable'}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

/* --------------------------------- actions -------------------------------- */

export function useAlertAction(id: string | undefined) {
  return useQuery({
    queryKey: qk.alertAction(id ?? ''),
    queryFn: () => api.get<AlertAction>(`/alerts/actions/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreateAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AlertActionWrite) => api.post<AlertAction>('/alerts/actions', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useUpdateAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AlertActionWrite & { id: string }) =>
      api.put<AlertAction>(`/alerts/actions/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useDeleteAlertAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/alerts/actions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
}

export function useTestAlertAction() {
  return useMutation({
    mutationFn: (id: string) => api.post<AlertActionTestResult>(`/alerts/actions/${id}/test`),
  });
}

/* ------------------------------ live SSE events --------------------------- */

export interface UseEventsOptions {
  /** Only invoke the handler for these event types (default: all). */
  types?: string[];
  enabled?: boolean;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Subscribe to the backend `/events` SSE stream. The handler ref is kept fresh
 * so the stream is opened once and never torn down on every render.
 */
export function useEvents(
  handler: (event: ServerEvent) => void,
  { types, enabled = true, onOpen, onError }: UseEventsOptions = {},
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const typeKey = types ? types.join(',') : '*';

  useEffect(() => {
    if (!enabled) return;
    const allow = typeKey === '*' ? null : new Set(typeKey.split(','));
    const close = sse('/events', {
      onOpen: () => openRef.current?.(),
      onError: (e) => errorRef.current?.(e),
      onEvent: (message) => {
        let payload: unknown = message.data;
        try {
          payload = message.data ? JSON.parse(message.data) : {};
        } catch {
          /* keep the raw string */
        }
        const record = (payload ?? {}) as Partial<ServerEvent>;
        const type = record.type ?? message.event;
        if (allow && !allow.has(type)) return;
        handlerRef.current({
          type,
          clusterId: record.clusterId ?? null,
          ts: record.ts ?? new Date().toISOString(),
          payload: record.payload ?? payload,
        });
      },
    });
    return close;
  }, [enabled, typeKey]);
}

/** Refresh alert history/summary whenever an `alert.*` event arrives. */
export function useAlertLiveUpdates(enabled = true) {
  const qc = useQueryClient();
  const seen = useRef(0);
  useEvents(
    () => {
      seen.current += 1;
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    { types: ['alert.fired', 'alert.resolved', 'alert.acked'], enabled },
  );
}
