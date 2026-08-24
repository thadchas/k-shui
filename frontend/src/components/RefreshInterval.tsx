import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import type { RefreshIntervalMs } from '@/stores/ui';

export interface RefreshIntervalProps {
  /** Invalidate only this query-key prefix; defaults to everything. */
  scope?: readonly unknown[];
  className?: string;
}

/**
 * Topbar refresh control. Writes to the persisted UI store which every query
 * hook reads through `useRefetchInterval()`.
 */
export function RefreshInterval({ scope, className }: RefreshIntervalProps) {
  const qc = useQueryClient();
  const isFetching = useIsFetching({ queryKey: scope as unknown[] | undefined }) > 0;

  return (
    <RefreshPicker
      className={className}
      refreshing={isFetching}
      onRefresh={() => {
        void qc.invalidateQueries(scope ? { queryKey: scope as unknown[] } : undefined);
      }}
    />
  );
}

export type { RefreshIntervalMs };
