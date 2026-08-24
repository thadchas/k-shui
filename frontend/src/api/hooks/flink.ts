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

/* ===========================================================================
 * Additions for the Flink feature pages (appended — nothing above changed).
 * ======================================================================== */
import { useCallback } from 'react';
import { apiUrl } from '@/api/client';
import type {
  FlinkBackpressure,
  FlinkCheckpointConfig,
  FlinkCheckpointsFull,
  FlinkClusterInfo,
  FlinkConfigEntry,
  FlinkExceptionsFull,
  FlinkJarsResponse,
  FlinkJobDetailFull,
  FlinkLogList,
  FlinkMetricEntry,
  FlinkOverview,
  FlinkRunJarRequest,
  FlinkSqlOperation,
  FlinkSqlResult,
  FlinkSqlSession,
  FlinkSqlSupport,
  FlinkSubtasksResponse,
  FlinkTaskManagerDetail,
  FlinkThreadDump,
  FlinkWatermark,
  FlinkWebConfig,
} from '@/api/types';

const flinkBase = (cluster: string, f: string) => `/clusters/${cluster}/flink/${f}`;

/** `GET /flink` with the gateway/commit extras the backend actually returns. */
export function useFlinkClusterList(cluster: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkClusters(cluster ?? ''),
    queryFn: () => api.get<FlinkClusterInfo[]>(`/clusters/${cluster}/flink`),
    enabled: Boolean(cluster),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkOverview(cluster: string | undefined, f: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkOverview(cluster ?? '', f ?? ''),
    queryFn: () => api.get<FlinkOverview>(`${flinkBase(cluster!, f!)}/overview`),
    enabled: Boolean(cluster && f),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkWebConfig(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'config'] as const,
    queryFn: () => api.get<FlinkWebConfig>(`${flinkBase(cluster!, f!)}/config`),
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

/** Full `GET /jobs/{jid}` payload including `vertices[].metrics` and `plan`. */
export function useFlinkJobDetail(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''),
    queryFn: () => api.get<FlinkJobDetailFull>(`${flinkBase(cluster!, f!)}/jobs/${jid}`),
    enabled: Boolean(cluster && f && jid),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkCheckpointsFull(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkCheckpoints(cluster ?? '', f ?? '', jid ?? ''),
    queryFn: () => api.get<FlinkCheckpointsFull>(`${flinkBase(cluster!, f!)}/jobs/${jid}/checkpoints`),
    enabled: Boolean(cluster && f && jid),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkCheckpointConfig(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkCheckpoints(cluster ?? '', f ?? '', jid ?? ''), 'config'] as const,
    queryFn: () =>
      api.get<FlinkCheckpointConfig>(`${flinkBase(cluster!, f!)}/jobs/${jid}/checkpoints/config`),
    enabled: Boolean(cluster && f && jid),
    retry: false,
  });
}

export function useFlinkExceptionsFull(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  return useQuery({
    queryKey: qk.flinkExceptions(cluster ?? '', f ?? '', jid ?? ''),
    queryFn: () => api.get<FlinkExceptionsFull>(`${flinkBase(cluster!, f!)}/jobs/${jid}/exceptions`),
    enabled: Boolean(cluster && f && jid),
    retry: false,
  });
}

/** Metric *names* available for a job (no `get=` param). */
export function useFlinkJobMetricNames(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''), 'metric-names'] as const,
    queryFn: () => api.get<FlinkMetricEntry[]>(`${flinkBase(cluster!, f!)}/jobs/${jid}/metrics`),
    enabled: Boolean(cluster && f && jid),
    staleTime: 60_000,
    retry: false,
  });
}

export function useFlinkJobMetricValues(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  names: string[],
  intervalMs = 5000,
) {
  return useQuery({
    queryKey: [...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''), 'metric-values', names] as const,
    queryFn: () =>
      api.get<FlinkMetricEntry[]>(`${flinkBase(cluster!, f!)}/jobs/${jid}/metrics`, {
        get: names.join(','),
      }),
    enabled: Boolean(cluster && f && jid) && names.length > 0,
    refetchInterval: intervalMs,
    retry: false,
  });
}

export function useFlinkVertexMetricNames(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  vertex: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''), 'vertex', vertex, 'metric-names'] as const,
    queryFn: () =>
      api.get<FlinkMetricEntry[]>(
        `${flinkBase(cluster!, f!)}/jobs/${jid}/vertices/${vertex}/metrics`,
      ),
    enabled: Boolean(cluster && f && jid && vertex),
    staleTime: 60_000,
    retry: false,
  });
}

export function useFlinkVertexMetricValues(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  vertex: string | undefined,
  names: string[],
  intervalMs = 5000,
) {
  return useQuery({
    queryKey: [
      ...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''),
      'vertex',
      vertex,
      'metric-values',
      names,
    ] as const,
    queryFn: () =>
      api.get<FlinkMetricEntry[]>(
        `${flinkBase(cluster!, f!)}/jobs/${jid}/vertices/${vertex}/metrics`,
        { get: names.join(',') },
      ),
    enabled: Boolean(cluster && f && jid && vertex) && names.length > 0,
    refetchInterval: intervalMs,
    retry: false,
  });
}

export function useFlinkVertexSubtasks(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  vertex: string | undefined,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: [...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''), 'vertex', vertex, 'subtasks'] as const,
    queryFn: () =>
      api.get<FlinkSubtasksResponse>(
        `${flinkBase(cluster!, f!)}/jobs/${jid}/vertices/${vertex}/subtasks`,
      ),
    enabled: Boolean(cluster && f && jid && vertex),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkVertexBackpressure(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  vertex: string | undefined,
) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: [
      ...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''),
      'vertex',
      vertex,
      'backpressure',
    ] as const,
    queryFn: () =>
      api.get<FlinkBackpressure>(
        `${flinkBase(cluster!, f!)}/jobs/${jid}/vertices/${vertex}/backpressure`,
      ),
    enabled: Boolean(cluster && f && jid && vertex),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkVertexWatermarks(
  cluster: string | undefined,
  f: string | undefined,
  jid: string | undefined,
  vertex: string | undefined,
) {
  return useQuery({
    queryKey: [
      ...qk.flinkJob(cluster ?? '', f ?? '', jid ?? ''),
      'vertex',
      vertex,
      'watermarks',
    ] as const,
    queryFn: () =>
      api.get<FlinkWatermark[]>(
        `${flinkBase(cluster!, f!)}/jobs/${jid}/vertices/${vertex}/watermarks`,
      ),
    enabled: Boolean(cluster && f && jid && vertex),
    retry: false,
  });
}

/* ------------------------------ task managers ----------------------------- */

export function useFlinkTaskManagerList(cluster: string | undefined, f: string | undefined) {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: qk.flinkTaskManagers(cluster ?? '', f ?? ''),
    queryFn: () => api.get<FlinkTaskManagerDetail[]>(`${flinkBase(cluster!, f!)}/taskmanagers`),
    enabled: Boolean(cluster && f),
    refetchInterval,
    retry: false,
  });
}

export function useFlinkTaskManager(
  cluster: string | undefined,
  f: string | undefined,
  id: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkTaskManagers(cluster ?? '', f ?? ''), id] as const,
    queryFn: () =>
      api.get<FlinkTaskManagerDetail>(`${flinkBase(cluster!, f!)}/taskmanagers/${id}`),
    enabled: Boolean(cluster && f && id),
    retry: false,
  });
}

export function useFlinkTaskManagerMetrics(
  cluster: string | undefined,
  f: string | undefined,
  id: string | undefined,
  names: string[],
) {
  return useQuery({
    queryKey: [...qk.flinkTaskManagers(cluster ?? '', f ?? ''), id, 'metrics', names] as const,
    queryFn: () =>
      api.get<FlinkMetricEntry[]>(`${flinkBase(cluster!, f!)}/taskmanagers/${id}/metrics`, {
        get: names.join(','),
      }),
    enabled: Boolean(cluster && f && id) && names.length > 0,
    refetchInterval: 5000,
    retry: false,
  });
}

export function useFlinkTaskManagerLogList(
  cluster: string | undefined,
  f: string | undefined,
  id: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qk.flinkTaskManagers(cluster ?? '', f ?? ''), id, 'logs'] as const,
    queryFn: () => api.get<FlinkLogList>(`${flinkBase(cluster!, f!)}/taskmanagers/${id}/logs`),
    enabled: Boolean(cluster && f && id) && enabled,
    retry: false,
  });
}

async function fetchText(path: string, params?: Record<string, string>): Promise<string> {
  const res = await api.get<Response>(path, params, { raw: true });
  return res.text();
}

export function useFlinkTaskManagerLogFile(
  cluster: string | undefined,
  f: string | undefined,
  id: string | undefined,
  file: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkTaskManagers(cluster ?? '', f ?? ''), id, 'log-file', file] as const,
    queryFn: () =>
      fetchText(`${flinkBase(cluster!, f!)}/taskmanagers/${id}/logs`, { file: file! }),
    enabled: Boolean(cluster && f && id && file),
    retry: false,
  });
}

export function useFlinkThreadDump(
  cluster: string | undefined,
  f: string | undefined,
  id: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qk.flinkTaskManagers(cluster ?? '', f ?? ''), id, 'thread-dump'] as const,
    queryFn: () =>
      api.get<FlinkThreadDump>(`${flinkBase(cluster!, f!)}/taskmanagers/${id}/thread-dump`),
    enabled: Boolean(cluster && f && id) && enabled,
    retry: false,
  });
}

/* ------------------------------- job manager ------------------------------ */

export function useFlinkJobManagerConfig(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'jm-config'] as const,
    queryFn: () => api.get<FlinkConfigEntry[]>(`${flinkBase(cluster!, f!)}/jobmanager/config`),
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

export function useFlinkJobManagerLogList(
  cluster: string | undefined,
  f: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'jm-logs'] as const,
    queryFn: () => api.get<FlinkLogList>(`${flinkBase(cluster!, f!)}/jobmanager/logs`),
    enabled: Boolean(cluster && f) && enabled,
    retry: false,
  });
}

export function useFlinkJobManagerLogFile(
  cluster: string | undefined,
  f: string | undefined,
  file: string | undefined,
) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'jm-log-file', file] as const,
    queryFn: () => fetchText(`${flinkBase(cluster!, f!)}/jobmanager/logs`, { file: file! }),
    enabled: Boolean(cluster && f && file),
    retry: false,
  });
}

export function useFlinkJobManagerMetricNames(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'jm-metric-names'] as const,
    queryFn: () => api.get<FlinkMetricEntry[]>(`${flinkBase(cluster!, f!)}/jobmanager/metrics`),
    enabled: Boolean(cluster && f),
    staleTime: 60_000,
    retry: false,
  });
}

export function useFlinkJobManagerMetricValues(
  cluster: string | undefined,
  f: string | undefined,
  names: string[],
) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'jm-metric-values', names] as const,
    queryFn: () =>
      api.get<FlinkMetricEntry[]>(`${flinkBase(cluster!, f!)}/jobmanager/metrics`, {
        get: names.join(','),
      }),
    enabled: Boolean(cluster && f) && names.length > 0,
    refetchInterval: 5000,
    retry: false,
  });
}

/* ----------------------------------- jars --------------------------------- */

export function useFlinkJarList(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: qk.flinkJars(cluster ?? '', f ?? ''),
    queryFn: async () => {
      const raw = await api.get<FlinkJarsResponse | FlinkJar[]>(`${flinkBase(cluster!, f!)}/jars`);
      return Array.isArray(raw) ? { files: raw } : { ...raw, files: raw.files ?? [] };
    },
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

export function useUploadFlinkJar(cluster: string, f: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api.post<unknown>(`${flinkBase(cluster, f)}/jars/upload`, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.flinkJars(cluster, f) }),
  });
}

export function useRunFlinkJar(cluster: string, f: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jarId, ...body }: FlinkRunJarRequest & { jarId: string }) =>
      api.post<{ jobid?: string }>(`${flinkBase(cluster, f)}/jars/${jarId}/run`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.flinkJobs(cluster, f) }),
  });
}

export function useDeleteFlinkJar(cluster: string, f: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jarId: string) => api.delete<void>(`${flinkBase(cluster, f)}/jars/${jarId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.flinkJars(cluster, f) }),
  });
}

/* -------------------------------- SQL gateway ----------------------------- */

export function useFlinkSqlSupport(cluster: string | undefined, f: string | undefined) {
  return useQuery({
    queryKey: [...qk.flinkOverview(cluster ?? '', f ?? ''), 'sql'] as const,
    queryFn: () => api.get<FlinkSqlSupport>(`${flinkBase(cluster!, f!)}/sql`),
    enabled: Boolean(cluster && f),
    retry: false,
  });
}

export function useFlinkSqlActions(cluster: string, f: string) {
  const base = flinkBase(cluster, f);

  const openSession = useCallback(
    (properties: Record<string, string> = {}) =>
      api.post<FlinkSqlSession>(`${base}/sql/sessions`, { properties }),
    [base],
  );

  const closeSession = useCallback(
    (session: string) => api.delete<void>(`${base}/sql/sessions/${session}`),
    [base],
  );

  const submit = useCallback(
    (session: string, statement: string, properties: Record<string, string> = {}) =>
      api.post<FlinkSqlOperation>(`${base}/sql/sessions/${session}/statements`, {
        statement,
        properties,
      }),
    [base],
  );

  const poll = useCallback(
    (session: string, operation: string, token = 0) =>
      api.get<FlinkSqlResult>(
        `${base}/sql/sessions/${session}/operations/${operation}/result`,
        { token },
      ),
    [base],
  );

  return { openSession, closeSession, submit, poll };
}

/** Direct URL for a Flink log download link. */
export function flinkLogUrl(
  cluster: string,
  f: string,
  kind: 'jobmanager' | 'taskmanagers',
  id: string | null,
  file: string,
): string {
  const path =
    kind === 'jobmanager'
      ? `${flinkBase(cluster, f)}/jobmanager/logs`
      : `${flinkBase(cluster, f)}/taskmanagers/${id}/logs`;
  return apiUrl(path, { file });
}

export interface FlinkSavepointVars {
  jid: string;
  targetDirectory: string | null;
  cancelJob?: boolean;
  drain?: boolean;
}

/** `POST /jobs/{jid}/savepoints` with drain support (stop-with-savepoint). */
export function useFlinkSavepoint(cluster: string, f: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jid, ...body }: FlinkSavepointVars) =>
      api.post<FlinkSavepointTrigger & { 'request-id'?: string }>(
        `${flinkBase(cluster, f)}/jobs/${jid}/savepoints`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.flinkJobs(cluster, f) });
    },
  });
}
