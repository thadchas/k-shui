/**
 * Schema Registry hooks. Query functions are wired to the contract; the pages
 * that consume them land with the Governance agent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/keys';
import type {
  CompatibilityCheckResponse,
  Compatibility,
  RegisterSchemaForSubject,
  RegisterSchemaRequest,
  RegisterSchemaResponse,
  SchemaDiff,
  SchemaRegistryConfig,
  SchemaRegistryInfo,
  SchemaSubjectDetail,
  SchemaSubjectSummary,
  SchemaVersion,
} from '@/api/types';

export function useSchemaSubjects(
  cluster: string | undefined,
  query: { search?: string; deleted?: boolean } = {},
) {
  return useQuery({
    queryKey: qk.schemaSubjects(cluster ?? '', query),
    queryFn: () => api.get<SchemaSubjectSummary[]>(`/clusters/${cluster}/schemas/subjects`, query),
    enabled: Boolean(cluster),
    retry: false,
  });
}

export function useSchemaSubject(cluster: string | undefined, subject: string | undefined) {
  return useQuery({
    queryKey: qk.schemaSubject(cluster ?? '', subject ?? ''),
    queryFn: () =>
      api.get<SchemaSubjectDetail>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject!)}`,
      ),
    enabled: Boolean(cluster && subject),
    retry: false,
  });
}

export function useSchemaVersion(
  cluster: string | undefined,
  subject: string | undefined,
  version: number | string | undefined,
) {
  return useQuery({
    queryKey: qk.schemaVersion(cluster ?? '', subject ?? '', version ?? ''),
    queryFn: () =>
      api.get<SchemaVersion>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject!)}/versions/${version}`,
      ),
    enabled: Boolean(cluster && subject && version !== undefined),
    retry: false,
  });
}

export function useSchemaDiff(
  cluster: string | undefined,
  subject: string | undefined,
  from: number | undefined,
  to: number | undefined,
) {
  return useQuery({
    queryKey: qk.schemaDiff(cluster ?? '', subject ?? '', from ?? 0, to ?? 0),
    queryFn: () =>
      api.get<SchemaDiff>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject!)}/diff`,
        { from, to },
      ),
    enabled: Boolean(cluster && subject && from && to),
    retry: false,
  });
}

export function useSchemaRegistryInfo(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.schemaRegistryInfo(cluster ?? ''),
    queryFn: () => api.get<SchemaRegistryInfo>(`/clusters/${cluster}/schemas/info`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useRegisterSchema(cluster: string, subject: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterSchemaRequest) =>
      api.post<{ id: number }>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/versions`,
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.schemaSubject(cluster, subject) }),
  });
}

export function useCheckCompatibility(cluster: string, subject: string) {
  return useMutation({
    mutationFn: (body: Pick<RegisterSchemaRequest, 'schema' | 'schemaType'>) =>
      api.post<CompatibilityCheckResponse>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/compatibility`,
        body,
      ),
  });
}

export function useDeleteSubject(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subject, permanent }: { subject: string; permanent?: boolean }) =>
      api.delete<void>(`/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}`, {
        permanent,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.schemaSubjects(cluster, {}).slice(0, 4) }),
  });
}

/* -------------------------------------------------------------------------- *
 * Additions for the Schemas pages. Query keys are derived from `qk` so they
 * stay inside the per-cluster cache scope.
 * -------------------------------------------------------------------------- */

/** Global registry compatibility (`GET /clusters/{c}/schemas/config`). */
export function useSchemaGlobalConfig(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.schemaGlobalConfig(cluster ?? ''),
    queryFn: () => api.get<SchemaRegistryConfig>(`/clusters/${cluster}/schemas/config`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useUpdateSchemaGlobalConfig(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (compatibility: Compatibility) =>
      api.put<SchemaRegistryConfig>(`/clusters/${cluster}/schemas/config`, { compatibility }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.schemaGlobalConfig(cluster) });
      void qc.invalidateQueries({ queryKey: qk.schemaSubjects(cluster, {}).slice(0, 4) });
    },
  });
}

/** Per-subject compatibility override (`GET .../subjects/{s}/config`). */
export function useSubjectConfig(
  cluster: string | undefined,
  subject: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qk.schemaSubject(cluster ?? '', subject ?? ''), 'config'] as const,
    queryFn: () =>
      api.get<SchemaRegistryConfig>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject!)}/config`,
      ),
    enabled: Boolean(cluster && subject) && enabled,
    retry: false,
  });
}

export function useUpdateSubjectConfig(cluster: string, subject: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (compatibility: Compatibility) =>
      api.put<SchemaRegistryConfig>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/config`,
        { compatibility },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [...qk.schemaSubject(cluster, subject), 'config'] as const,
      });
      void qc.invalidateQueries({ queryKey: qk.schemaSubject(cluster, subject) });
      void qc.invalidateQueries({ queryKey: qk.schemaSubjects(cluster, {}).slice(0, 4) });
    },
  });
}

/** Register a new version against a subject chosen at call time. */
export function useRegisterSchemaForSubject(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subject, ...body }: RegisterSchemaForSubject) =>
      api.post<RegisterSchemaResponse>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/versions`,
        body,
      ),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: qk.schemaSubject(cluster, variables.subject) });
      void qc.invalidateQueries({ queryKey: qk.schemaSubjects(cluster, {}).slice(0, 4) });
    },
  });
}

/** Compatibility check against a subject chosen at call time. */
export function useCheckCompatibilityForSubject(cluster: string) {
  return useMutation({
    mutationFn: ({
      subject,
      ...body
    }: Pick<RegisterSchemaRequest, 'schema' | 'schemaType'> & { subject: string }) =>
      api.post<CompatibilityCheckResponse>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/compatibility`,
        body,
      ),
  });
}

export function useDeleteSchemaVersion(cluster: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      subject,
      version,
      permanent,
    }: {
      subject: string;
      version: number;
      permanent?: boolean;
    }) =>
      api.delete<void>(
        `/clusters/${cluster}/schemas/subjects/${encodeURIComponent(subject)}/versions/${version}`,
        { permanent },
      ),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: qk.schemaSubject(cluster, variables.subject) });
      void qc.invalidateQueries({ queryKey: qk.schemaSubjects(cluster, {}).slice(0, 4) });
    },
  });
}
