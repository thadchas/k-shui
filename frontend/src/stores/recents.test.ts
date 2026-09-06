import { beforeEach, describe, expect, it } from 'vitest';
import type { ResourceRef } from '@/lib/scope';
import {
  RECENTS_PER_CLUSTER,
  addRecentEntry,
  entriesForCluster,
  entryKey,
  removeEntry,
  togglePinnedEntry,
  useRecentsStore,
  type ResourceEntry,
} from './recents';

function topic(clusterId: string, name: string, at = 0): ResourceEntry {
  return { clusterId, type: 'topic', name, path: `/c/${clusterId}/topics/${name}`, at };
}

const ref = (e: ResourceEntry): ResourceRef => ({
  clusterId: e.clusterId,
  type: e.type,
  name: e.name,
  path: e.path,
});

describe('entryKey', () => {
  it('separates same-named resources in different clusters and of different types', () => {
    expect(entryKey(topic('a', 'orders'))).not.toBe(entryKey(topic('b', 'orders')));
    expect(entryKey(topic('a', 'orders'))).not.toBe(
      entryKey({ ...topic('a', 'orders'), type: 'consumer-group' }),
    );
  });
});

describe('addRecentEntry', () => {
  it('puts the newest visit first', () => {
    const list = addRecentEntry(addRecentEntry([], topic('a', 'one', 1)), topic('a', 'two', 2));
    expect(list.map((e) => e.name)).toEqual(['two', 'one']);
  });

  it('deduplicates a revisit instead of growing the list', () => {
    let list = addRecentEntry([], topic('a', 'one', 1));
    list = addRecentEntry(list, topic('a', 'two', 2));
    list = addRecentEntry(list, topic('a', 'one', 3));
    expect(list.map((e) => e.name)).toEqual(['one', 'two']);
    expect(list[0].at).toBe(3);
  });

  it('caps entries per cluster without evicting other clusters', () => {
    let list: ResourceEntry[] = [];
    for (let i = 0; i < RECENTS_PER_CLUSTER + 4; i += 1) {
      list = addRecentEntry(list, topic('a', `t${i}`, i));
    }
    list = addRecentEntry(list, topic('b', 'other', 99));

    expect(entriesForCluster(list, 'a')).toHaveLength(RECENTS_PER_CLUSTER);
    expect(entriesForCluster(list, 'b')).toHaveLength(1);
    // The oldest cluster-a visits fell off; the newest survived.
    expect(list.some((e) => e.name === 't0')).toBe(false);
    expect(list.some((e) => e.name === `t${RECENTS_PER_CLUSTER + 3}`)).toBe(true);
  });

  it('honours an explicit cap', () => {
    let list: ResourceEntry[] = [];
    for (let i = 0; i < 5; i += 1) list = addRecentEntry(list, topic('a', `t${i}`, i), 2);
    expect(list.map((e) => e.name)).toEqual(['t4', 't3']);
  });
});

describe('togglePinnedEntry / removeEntry', () => {
  it('pins when absent and unpins when present', () => {
    const entry = topic('a', 'orders', 1);
    const pinned = togglePinnedEntry([], entry);
    expect(pinned).toHaveLength(1);
    expect(togglePinnedEntry(pinned, entry)).toHaveLength(0);
  });

  it('unpins by identity, not by object reference', () => {
    const pinned = togglePinnedEntry([], topic('a', 'orders', 1));
    expect(togglePinnedEntry(pinned, topic('a', 'orders', 500))).toHaveLength(0);
    expect(togglePinnedEntry(pinned, topic('b', 'orders', 500))).toHaveLength(2);
  });

  it('removeEntry drops only the matching resource', () => {
    const list = [topic('a', 'one', 1), topic('a', 'two', 2)];
    expect(removeEntry(list, ref(topic('a', 'one'))).map((e) => e.name)).toEqual(['two']);
  });
});

describe('entriesForCluster', () => {
  it('filters by cluster, keeps order, and applies the limit', () => {
    const list = [topic('a', 'one', 3), topic('b', 'x', 2), topic('a', 'two', 1)];
    expect(entriesForCluster(list, 'a').map((e) => e.name)).toEqual(['one', 'two']);
    expect(entriesForCluster(list, 'a', 1).map((e) => e.name)).toEqual(['one']);
    expect(entriesForCluster(list, null)).toEqual([]);
  });
});

describe('useRecentsStore', () => {
  beforeEach(() => {
    useRecentsStore.setState({ recents: [], pinned: [] });
  });

  it('records visits and ignores a repeat of the newest entry', () => {
    const orders = ref(topic('a', 'orders'));
    const billing = ref(topic('a', 'billing'));
    useRecentsStore.getState().record(orders, 1);
    const afterFirst = useRecentsStore.getState().recents;
    useRecentsStore.getState().record(orders, 2);
    expect(useRecentsStore.getState().recents).toBe(afterFirst);

    useRecentsStore.getState().record(billing, 3);
    expect(useRecentsStore.getState().recents.map((e) => e.name)).toEqual(['billing', 'orders']);
  });

  it('toggles pins and reports pinned state', () => {
    const orders = ref(topic('a', 'orders'));
    expect(useRecentsStore.getState().isPinned(orders)).toBe(false);
    useRecentsStore.getState().togglePin(orders, 1);
    expect(useRecentsStore.getState().isPinned(orders)).toBe(true);
    useRecentsStore.getState().togglePin(orders, 2);
    expect(useRecentsStore.getState().isPinned(orders)).toBe(false);
  });

  it('forget and clearCluster drop entries from both lists', () => {
    const a1 = ref(topic('a', 'one'));
    const a2 = ref(topic('a', 'two'));
    const b1 = ref(topic('b', 'one'));
    const store = useRecentsStore.getState();
    store.record(a1, 1);
    store.record(a2, 2);
    store.record(b1, 3);
    store.togglePin(a1, 4);

    store.forget(a1);
    expect(useRecentsStore.getState().pinned).toHaveLength(0);
    expect(useRecentsStore.getState().recents.map((e) => e.clusterId)).toEqual(['b', 'a']);

    store.clearCluster('a');
    expect(useRecentsStore.getState().recents.map((e) => e.clusterId)).toEqual(['b']);
  });
});
