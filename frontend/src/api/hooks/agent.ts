import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type {
  AgentInvestigation,
  AgentOperation,
  AgentStatus,
  CreateInvestigation,
} from '@/api/agentTypes';
import { useEffect } from 'react';
import { useAgentStore } from '@/stores/agent';
import { useInfo } from './system';

const path = (id: string) => `/agent/investigations/${encodeURIComponent(id)}`;
export function useAgentStatus() {
  const info = useInfo();
  const identity = info.data?.auth.enabled
    ? (info.data.auth.user?.username ?? 'unauthenticated')
    : 'anonymous';
  const owner = useAgentStore((s) => s.owner);
  const qc = useQueryClient();
  useEffect(() => {
    if (!info.data) return;
    if (owner !== identity) {
      useAgentStore.getState().bindIdentity(identity);
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] === 'agent' && query.queryKey[1] !== identity,
      });
    }
  }, [identity, info.data, owner, qc]);
  const query = useQuery({
    queryKey: ['agent', identity, 'status'],
    enabled: !!info.data,
    queryFn: () => api.get<AgentStatus>('/agent/status'),
    staleTime: 15_000,
    retry: false,
  });
  return { ...query, data: owner === identity ? query.data : undefined };
}
export function useInvestigations(enabled: boolean) {
  const status = useAgentStatus();
  return useQuery({
    queryKey: ['agent', status.data?.actingUser, 'investigations'],
    queryFn: () => api.get<AgentInvestigation[]>('/agent/investigations'),
    enabled: enabled && !!status.data?.enabled,
    retry: false,
  });
}
export function useInvestigation(id: string | null) {
  const executing = useIsMutating({ mutationKey: ['agent-operation'] });
  const status = useAgentStatus();
  return useQuery({
    queryKey: ['agent', status.data?.actingUser, 'investigation', id],
    queryFn: () => api.get<AgentInvestigation>(path(id!)),
    enabled: !!id && !!status.data?.enabled,
    refetchInterval: (query) =>
      executing ||
      query.state.data?.status === 'running' ||
      query.state.data?.operations?.some((operation) =>
        ['running', 'verifying'].includes(operation.status),
      )
        ? 1000
        : false,
    retry: false,
  });
}
export function useAgentActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agent'] });
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateInvestigation) =>
        api.post<AgentInvestigation>('/agent/investigations', body),
      onSuccess: refresh,
    }),
    send: useMutation({
      mutationFn: ({ id, content }: { id: string; content: string }) =>
        api.post<AgentInvestigation>(`${path(id)}/messages`, {
          content,
          requestId: crypto.randomUUID(),
        }),
      onSuccess: refresh,
      retry: false,
    }),
    cancel: useMutation({
      mutationFn: (id: string) => api.post<AgentInvestigation>(`${path(id)}/cancel`, {}),
      onSuccess: refresh,
      retry: false,
    }),
    execute: useMutation({
      mutationKey: ['agent-operation'],
      mutationFn: ({
        id,
        operationId,
        confirmation,
      }: {
        id: string;
        operationId: string;
        confirmation: string;
      }) =>
        api.post<AgentOperation>(
          `${path(id)}/operations/${encodeURIComponent(operationId)}/execute`,
          { confirmation },
        ),
      onSettled: refresh,
      retry: false,
    }),
    cancelOperation: useMutation({
      mutationKey: ['agent-operation'],
      mutationFn: ({ id, operationId }: { id: string; operationId: string }) =>
        api.post<AgentOperation>(
          `${path(id)}/operations/${encodeURIComponent(operationId)}/cancel`,
          {},
        ),
      onSettled: refresh,
      retry: false,
    }),
    reprepare: useMutation({
      mutationKey: ['agent-operation'],
      mutationFn: async (operation: AgentOperation) => {
        const cancelled = await api.post<AgentOperation>(
          `${path(operation.investigationId)}/operations/${encodeURIComponent(operation.id)}/cancel`,
          {},
        );
        if (cancelled.status !== 'cancelled')
          throw new Error(
            'This operation was already accepted. Reconcile its outcome before preparing another.',
          );
        return api.post<AgentOperation>(`${path(operation.investigationId)}/operations/prepare`, {
          action: operation.action,
          target: operation.target,
          parameters: operation.parameters,
        });
      },
      onSettled: refresh,
      retry: false,
    }),
    refreshEvidence: useMutation({
      mutationFn: ({ id, evidenceId }: { id: string; evidenceId: string }) =>
        api.post<AgentInvestigation>(
          `${path(id)}/evidence/${encodeURIComponent(evidenceId)}/refresh`,
          {},
        ),
      onSettled: refresh,
      retry: false,
    }),
    test: useMutation({
      mutationFn: (id: string) =>
        api.post<{ state: string; recovery?: string; toolCapable: boolean; testedAt: string }>(
          `/agent/connections/${encodeURIComponent(id)}/test`,
          {},
        ),
      onSuccess: refresh,
      retry: false,
    }),
  };
}
