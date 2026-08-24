import { useEffect } from 'react';
import { useParams } from 'react-router';
import { useUiStore } from '@/stores/ui';

/** Current `:cluster` route param, remembered for the next session. */
export function useClusterId(): string {
  const { cluster } = useParams<{ cluster: string }>();
  const setLastClusterId = useUiStore((s) => s.setLastClusterId);

  useEffect(() => {
    if (cluster) setLastClusterId(cluster);
  }, [cluster, setLastClusterId]);

  return cluster ?? '';
}
