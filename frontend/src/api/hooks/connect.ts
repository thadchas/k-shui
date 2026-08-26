/** Kafka Connect hooks — pages land with the Streaming agent. */
import { useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  ConnectCluster,
  Connector,
  ConnectorOffsets,
  ConnectorOffsetsPatch,
  ConnectorPlugin,
  ConnectorTopicsResponse,
  ConnectorValidationResult,
  CreateConnectorRequest,
} from '@/api/types';

/* -------------------------------------------------------------------------- *
 * Fast-poll burst: after a mutation (restart / pause / resume / stop / task
 * restart / config save) connector status is refetched every 2s for ~20s so the
 * UI settles on the new state without waiting for the regular interval.
 * -------------------------------------------------------------------------- */

export const FAST_POLL_INTERVAL_MS = 2000;
export const FAST_POLL_DURATION_MS = 20000;

let fastPollUntil = 0;
let fastPollTimer: ReturnType<typeof setTimeout> | null = null;
const fastPollListeners = new Set<() => void>();

function emitFastPoll() {
  for (const listener of fastPollListeners) listener();
}

/** Start (or extend) a fast-poll burst for connector queries. */
export function startFastPoll(durationMs = FAST_POLL_DURATION_MS) {
  fastPollUntil = Date.now() + durationMs;
  if (fastPollTimer) clearTimeout(fastPollTimer);
  fastPollTimer = setTimeout(() => {
    fastPollTimer = null;
    fastPollUntil = 0;
    emitFastPoll();
  }, durationMs);
  emitFastPoll();
}

function subscribeFastPoll(listener: () => void) {
  fastPollListeners.add(listener);
  return () => {
    fastPollListeners.delete(listener);
  };
}

/** True while a fast-poll burst is active. */
export function useFastPollActive(): boolean {
  return useSyncExternalStore(
    subscribeFastPoll,
    () => fastPollUntil > 0,
    () => false,
  );
}

/** Regular refetch interval, overridden to 2s during a fast-poll burst. */
function useConnectRefetchInterval(): number | false {
  const base = useRefetchInterval();
  const fast = useFastPollActive();
  return fast ? FAST_POLL_INTERVAL_MS : base;
}

export function useConnectClusters(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.connectClusters(cluster ?? ''),
    queryFn: () => api.get<ConnectCluster[]>(`/clusters/${cluster}/connect`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useConnectors(
  cluster: string | undefined,
  kc: string | undefined,
  query: { search?: string; state?: string; type?: string } = {},
) {
  const refetchInterval = useConnectRefetchInterval();
  return useQuery({
    queryKey: qk.connectors(cluster ?? '', kc ?? '', query),
    queryFn: () => api.get<Connector[]>(`/clusters/${cluster}/connect/${kc}/connectors`, query),
    enabled: Boolean(cluster && kc),
    refetchInterval,
    retry: false,
  });
}

export function useConnector(
  cluster: string | undefined,
  kc: string | undefined,
  name: string | undefined,
) {
  const refetchInterval = useConnectRefetchInterval();
  return useQuery({
    queryKey: qk.connector(cluster ?? '', kc ?? '', name ?? ''),
    queryFn: () =>
      api.get<Connector>(
        `/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name!)}`,
      ),
    enabled: Boolean(cluster && kc && name),
    refetchInterval,
    retry: false,
  });
}

export function useConnectorOffsets(cluster: string, kc: string, name: string) {
  return useQuery({
    queryKey: qk.connectorOffsets(cluster, kc, name),
    queryFn: () =>
      api.get<ConnectorOffsets>(
        `/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name)}/offsets`,
      ),
    retry: false,
  });
}

export function useConnectPlugins(cluster: string | undefined, kc: string | undefined) {
  return useQuery({
    queryKey: qk.connectPlugins(cluster ?? '', kc ?? ''),
    queryFn: () => api.get<ConnectorPlugin[]>(`/clusters/${cluster}/connect/${kc}/plugins`),
    enabled: Boolean(cluster && kc),
    retry: false,
  });
}

export function useCreateConnector(cluster: string, kc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnectorRequest) =>
      api.post<Connector>(`/clusters/${cluster}/connect/${kc}/connectors`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connectClusters(cluster) }),
  });
}

export function useUpdateConnectorConfig(cluster: string, kc: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, string>) =>
      api.put<Connector>(
        `/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name)}/config`,
        config,
      ),
    onSuccess: () => {
      startFastPoll();
      return qc.invalidateQueries({ queryKey: qk.connector(cluster, kc, name) });
    },
  });
}

export type ConnectorAction = 'pause' | 'resume' | 'stop' | 'restart';

export function useConnectorAction(cluster: string, kc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      action,
      includeTasks,
      onlyFailed,
    }: {
      name: string;
      action: ConnectorAction;
      includeTasks?: boolean;
      onlyFailed?: boolean;
    }) =>
      api.post<void>(
        `/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name)}/${action}`,
        undefined,
        { includeTasks, onlyFailed },
      ),
    onSuccess: (_d, v) => {
      startFastPoll();
      return qc.invalidateQueries({ queryKey: qk.connector(cluster, kc, v.name) });
    },
  });
}

export function useDeleteConnector(cluster: string, kc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<void>(`/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connectClusters(cluster) }),
  });
}

export function useValidatePlugin(cluster: string, kc: string) {
  return useMutation({
    mutationFn: ({
      pluginClass,
      config,
    }: {
      pluginClass: string;
      config: Record<string, string>;
    }) =>
      api.put<ConnectorValidationResult>(
        `/clusters/${cluster}/connect/${kc}/plugins/${encodeURIComponent(pluginClass)}/validate`,
        config,
      ),
  });
}

/* -------------------------------------------------------------------------- *
 * Additions for the Connect pages.
 * -------------------------------------------------------------------------- */

function connectorPath(cluster: string, kc: string, name: string) {
  return `/clusters/${cluster}/connect/${kc}/connectors/${encodeURIComponent(name)}`;
}

export function useConnectCluster(cluster: string | undefined, kc: string | undefined) {
  const query = useConnectClusters(cluster, Boolean(cluster && kc));
  return {
    ...query,
    data: query.data?.find((c) => c.name === kc),
  };
}

export function useConnectorConfig(
  cluster: string | undefined,
  kc: string | undefined,
  name: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.connectorConfig(cluster ?? '', kc ?? '', name ?? ''),
    queryFn: () => api.get<Record<string, string>>(`${connectorPath(cluster!, kc!, name!)}/config`),
    enabled: Boolean(cluster && kc && name) && enabled,
    retry: false,
  });
}

export function useConnectorTopics(
  cluster: string | undefined,
  kc: string | undefined,
  name: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qk.connector(cluster ?? '', kc ?? '', name ?? ''), 'topics'] as const,
    queryFn: () =>
      api.get<ConnectorTopicsResponse | string[]>(`${connectorPath(cluster!, kc!, name!)}/topics`),
    enabled: Boolean(cluster && kc && name) && enabled,
    retry: false,
  });
}

export function useResetConnectorTopics(cluster: string, kc: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.put<void>(`${connectorPath(cluster, kc, name)}/topics/reset`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [...qk.connector(cluster, kc, name), 'topics'] as const }),
  });
}

export function useRestartConnectorTask(cluster: string, kc: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) =>
      api.post<void>(`${connectorPath(cluster, kc, name)}/tasks/${taskId}/restart`),
    onSuccess: () => {
      startFastPoll();
      return qc.invalidateQueries({ queryKey: qk.connector(cluster, kc, name) });
    },
  });
}

export function usePatchConnectorOffsets(cluster: string, kc: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectorOffsetsPatch) =>
      api.patch<{ message?: string }>(`${connectorPath(cluster, kc, name)}/offsets`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connectorOffsets(cluster, kc, name) }),
  });
}

export function useResetConnectorOffsets(cluster: string, kc: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete<{ message?: string }>(`${connectorPath(cluster, kc, name)}/offsets`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connectorOffsets(cluster, kc, name) }),
  });
}
