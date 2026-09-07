import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuthStore } from '@/stores/auth';
import type {
  AuditEntry,
  AuditQuery,
  ConnectionTestRequest,
  ConnectionTestResponse,
  GeneratedClusterConfig,
  InfoResponse,
  LoginRequest,
  LoginResponse,
  Page,
  User,
} from '@/api/types';

export function useInfo() {
  return useQuery({
    queryKey: qk.info(),
    queryFn: () => api.get<InfoResponse>('/info'),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: qk.me(),
    queryFn: () => api.get<User>('/auth/me'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api.post<LoginResponse>('/auth/login', body),
    onSuccess: (data) => {
      setSession(data.token, data.user);
      void qc.invalidateQueries();
    },
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api.post<void>('/auth/logout');
      } catch {
        /* logging out locally is enough */
      }
    },
    onSettled: () => {
      clear();
      qc.clear();
    },
  });
}

/**
 * Probe candidate cluster connection details (admin only). Changes nothing on the
 * server: the cluster inventory is deployment-managed, so the response also carries the
 * YAML fragment to apply. Not cached — a test is an explicit user action.
 */
export function useConnectionTest() {
  return useMutation({
    mutationFn: (body: ConnectionTestRequest) =>
      api.post<ConnectionTestResponse>('/system/connection-test', body),
  });
}

/** Render the k-shui.yaml fragment for these details without probing anything. */
export function useConnectionConfig() {
  return useMutation({
    mutationFn: (body: ConnectionTestRequest) =>
      api.post<GeneratedClusterConfig>('/system/connection-config', body),
  });
}

export function useAudit(query: AuditQuery) {
  return useQuery({
    queryKey: qk.audit(query),
    queryFn: () =>
      api.get<Page<AuditEntry>>('/audit', {
        page: query.page,
        perPage: query.perPage,
        clusterId: query.clusterId,
        user: query.user,
        action: query.action,
      }),
    placeholderData: (prev) => prev,
  });
}
