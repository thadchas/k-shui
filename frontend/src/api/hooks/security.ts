import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import type { Acl, AclQuery, CreateScramUserRequest, Quota, ScramUser } from '@/api/types';

export function useAcls(cluster: string | undefined, query: AclQuery = {}) {
  return useQuery({
    queryKey: qk.acls(cluster ?? '', query),
    queryFn: () =>
      api.get<Acl[]>(`/clusters/${cluster}/acls`, {
        resourceType: query.resourceType,
        resourceName: query.resourceName,
        principal: query.principal,
      }),
    enabled: Boolean(cluster),
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useCreateAcl(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Acl) => api.post<void>(`/clusters/${cluster}/acls`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...qk.acls(cluster, {})].slice(0, 3) }),
  });
}

export function useDeleteAcl(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (acl: Acl) =>
      api.delete<void>(`/clusters/${cluster}/acls`, {
        resourceType: acl.resourceType,
        resourceName: acl.resourceName,
        patternType: acl.patternType,
        principal: acl.principal,
        host: acl.host,
        operation: acl.operation,
        permissionType: acl.permissionType,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...qk.acls(cluster, {})].slice(0, 3) }),
  });
}

export function useQuotas(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.quotas(cluster ?? ''),
    queryFn: () => api.get<Quota[]>(`/clusters/${cluster}/quotas`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useUpsertQuota(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Quota) => api.put<void>(`/clusters/${cluster}/quotas`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quotas(cluster) }),
  });
}

export function useDeleteQuota(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quota: Quota) =>
      api.delete<void>(`/clusters/${cluster}/quotas`, {
        entityType: quota.entityType,
        entityName: quota.entityName,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quotas(cluster) }),
  });
}

export function useScramUsers(cluster: string | undefined) {
  return useQuery({
    queryKey: qk.scramUsers(cluster ?? ''),
    queryFn: () => api.get<ScramUser[]>(`/clusters/${cluster}/scram-users`),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useCreateScramUser(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScramUserRequest) =>
      api.post<void>(`/clusters/${cluster}/scram-users`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.scramUsers(cluster) }),
  });
}

export function useDeleteScramUser(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, mechanism }: { name: string; mechanism?: string }) =>
      api.delete<void>(`/clusters/${cluster}/scram-users`, { name, mechanism }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.scramUsers(cluster) }),
  });
}
