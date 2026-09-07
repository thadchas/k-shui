/**
 * Router glue for the pinned/recent resource lists. Kept out of the store so the store
 * stays a plain, testable data structure.
 */
import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import { matchResourceRoute, type ResourceRef } from '@/lib/scope';
import { entriesForCluster, useRecentsStore, type ResourceEntry } from '@/stores/recents';

/** Records the current route in the recents list when it is a resource-detail route. */
export function useRecordRecentResource(): ResourceRef | null {
  const { pathname } = useLocation();
  const record = useRecentsStore((s) => s.record);
  const ref = useMemo(() => matchResourceRoute(pathname), [pathname]);

  useEffect(() => {
    if (ref) record(ref);
  }, [ref, record]);

  return ref;
}

export interface ClusterResourceLists {
  pinned: ResourceEntry[];
  /** Recents with the pinned entries removed, so nothing is listed twice. */
  recent: ResourceEntry[];
}

/** Pinned + recent entries for one cluster, ready to render. */
export function useClusterResources(
  clusterId: string | null,
  recentLimit = 5,
): ClusterResourceLists {
  const recents = useRecentsStore((s) => s.recents);
  const pinnedAll = useRecentsStore((s) => s.pinned);

  return useMemo(() => {
    const pinned = entriesForCluster(pinnedAll, clusterId);
    const pinnedPaths = new Set(pinned.map((e) => e.path));
    const recent = entriesForCluster(recents, clusterId).filter((e) => !pinnedPaths.has(e.path));
    return { pinned, recent: recent.slice(0, recentLimit) };
  }, [recents, pinnedAll, clusterId, recentLimit]);
}
