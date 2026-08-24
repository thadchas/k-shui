/** Flink hooks — pages land with the Streaming agent. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useRefetchInterval } from '@/stores/ui';
import type {
  FlinkCheckpoints,
  FlinkCluster,
  FlinkExceptions,
  FlinkJar,
  FlinkJob,
  FlinkJobDetail,
  FlinkSavepointTrigger,
  FlinkTaskManager,
} from '@/api/types';

export function useFlinkClusters(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.flinkClusters(cluster ?? ''),
    queryFn: () => api.get<FlinkCluster[]>(`/clusters/${cluster}/flink`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useFlinkJobs(cluster: string | undefined, f: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkJobs(cluster ?? '', f ?? ''),
    queryFn: () => api.get<FlinkJob[]>(`/clusters/${cluster}/flink/${f}/jobs`),
    enabled: Boolean(cluster && f),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkJob(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''),
    queryFn: () => api.get<FlinkJobDetail>(`/clusters/${cluster}/flink/${f}/jobs/${jid}`),
    enabled: Boolean(cluster && f && jid),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkCheckpoints(cluster: string, f: string, jid: string) {
  return useQuery({
    queryKey: qk.flinkCheckpoints(cluster, f, jid),
    queryFn: () =>
      api.get<FlinkCheckpoints>(`/clusters/${cluster}/flink/${f}/jobs/${jid}/checkpoints`),
    retry: false,
  });
}

export function useFlinkExceptions(cluster: string, f: string, jid: string) {
  return useQuery({
    queryKey: qk.flinkExceptions(cluster, f, jid),
    queryFn: () =>
      api.get<FlinkExceptions>(`/clusters/${cluster}/flink/${f}/jobs/${jid}/exceptions`),
    retry: false,
  });
}

export function useFlinkTaskManagers(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: qk.flinkTaskManagers(cluster ?? '', f ?? ''),
    queryFn: () => api.get<FlinkTaskManager[]>(`/clusters/${cluster}/flink/${f}/taskmanagers`),
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

export function useFlinkJars(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: qk.flinkJars(cluster ?? '', f ?? ''),
    queryFn: () => api.get<FlinkJar[]>(`/clusters/${cluster}/flink/${f}/jars`),
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

export function useFlinkJobAction(cluster: string, f: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, mode }: { jid: string; mode: 'cancel' | 'stop' }) =>
      api.patch<void>(`/clusters/${cluster}/flink/${f}/jobs/${jid}`, undefined, { mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.flinkJobs(cluster, f) }),
  });
}

export function useTriggerSavepoint(cluster: string, f: string) {
  return useMutation({
    mutationFn: ({
      jid,
      targetDirectory,
      cancelJob,
    }: {
      jid: string;
      targetDirectory: string;
      cancelJob?: boolean;
    }) =>
      api.post<FlinkSavepointTrigger>(`/clusters/${cluster}/flink/${f}/jobs/${jid}/savepoints`, {
        targetDirectory,
        cancelJob,
      }),
  });
}
