import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '@/api/client';
import { useAgentStore } from '@/stores/agent';
import { useAgentStatus } from './agent';

const info = vi.hoisted(() => ({ username: 'alice' }));
vi.mock('./system', () => ({
  useInfo: () => ({ data: { auth: { enabled: true, user: { username: info.username } } } }),
}));
vi.mock('@/api/client', () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  info.username = 'alice';
  useAgentStore.setState({
    owner: 'alice',
    investigationId: 'private',
    draft: 'private prompt',
    context: { clusterId: 'private-cluster' },
  });
});

describe('agent identity boundary', () => {
  it('uses server identity for OIDC users and removes previous-user cached investigations', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['agent', 'alice', 'investigation', 'private'], {
      messages: [{ content: 'private evidence' }],
    });
    vi.mocked(api.get).mockImplementation(
      async () => ({ enabled: true, actingUser: info.username }) as never,
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useAgentStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.actingUser).toBe('alice'));
    info.username = 'bob';
    rerender();
    await waitFor(() => expect(result.current.data?.actingUser).toBe('bob'));
    expect(qc.getQueryData(['agent', 'alice', 'investigation', 'private'])).toBeUndefined();
    expect(useAgentStore.getState()).toMatchObject({
      owner: 'bob',
      context: {},
      investigationId: null,
      draft: '',
    });
    qc.clear();
  });
});
