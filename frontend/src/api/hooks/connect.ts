/** Kafka Connect hooks — pages land with the Streaming agent. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  ConnectCluster,
  Connector,
  ConnectorOffsets,
  ConnectorPlugin,
  ConnectorValidationResult,
  CreateConnectorRequest,
} from '@/api/types';

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
  const refetchInterval = useRefetchInterval();
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
  const refetchInterval = useRefetchInterval();
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.connector(cluster, kc, name) }),
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
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: qk.connector(cluster, kc, v.name) }),
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
