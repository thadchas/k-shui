import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useRecentsStore } from '@/stores/recents';
import { useClusterResources, useRecordRecentResource } from './useRecentResources';

function wrapper(path: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
}

describe('useRecordRecentResource', () => {
  beforeEach(() => {
    useRecentsStore.setState({ recents: [], pinned: [] });
  });

  it('records a resource-detail route and returns the ref', () => {
    const { result } = renderHook(() => useRecordRecentResource(), {
      wrapper: wrapper('/c/local/topics/orders?tab=messages'),
    });
    expect(result.current).toMatchObject({ clusterId: 'local', type: 'topic', name: 'orders' });
    expect(useRecentsStore.getState().recents).toHaveLength(1);
    expect(useRecentsStore.getState().recents[0].path).toBe('/c/local/topics/orders');
  });

  it('records nothing on list, creation and global routes', () => {
    for (const path of ['/c/local/topics', '/c/local/topics/new', '/alerts', '/audit']) {
      const { result } = renderHook(() => useRecordRecentResource(), { wrapper: wrapper(path) });
      expect(result.current).toBeNull();
    }
    expect(useRecentsStore.getState().recents).toEqual([]);
  });
});

describe('useClusterResources', () => {
  beforeEach(() => {
    useRecentsStore.setState({ recents: [], pinned: [] });
  });

  it('scopes both lists to the cluster and never lists a pinned entry twice', () => {
    const store = useRecentsStore.getState();
    const orders = {
      clusterId: 'a',
      type: 'topic' as const,
      name: 'orders',
      path: '/c/a/topics/orders',
    };
    store.record(orders, 1);
    store.record({ ...orders, name: 'billing', path: '/c/a/topics/billing' }, 2);
    store.record({ ...orders, clusterId: 'b', path: '/c/b/topics/orders' }, 3);
    store.togglePin(orders, 4);

    const { result } = renderHook(() => useClusterResources('a'), { wrapper: wrapper('/c/a') });
    expect(result.current.pinned.map((e) => e.name)).toEqual(['orders']);
    expect(result.current.recent.map((e) => e.name)).toEqual(['billing']);

    const other = renderHook(() => useClusterResources('b'), { wrapper: wrapper('/c/b') });
    expect(other.result.current.pinned).toEqual([]);
    expect(other.result.current.recent.map((e) => e.path)).toEqual(['/c/b/topics/orders']);
  });

  it('returns empty lists without a cluster in scope', () => {
    const { result } = renderHook(() => useClusterResources(null), { wrapper: wrapper('/alerts') });
    expect(result.current).toEqual({ pinned: [], recent: [] });
  });
});
