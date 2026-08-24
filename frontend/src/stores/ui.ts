import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RefreshIntervalMs = 0 | 5000 | 30000 | 60000 | 300000;

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  refreshInterval: RefreshIntervalMs;
  setRefreshInterval: (ms: RefreshIntervalMs) => void;

  lastClusterId: string | null;
  setLastClusterId: (id: string | null) => void;

  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      refreshInterval: 30000,
      setRefreshInterval: (ms) => set({ refreshInterval: ms }),

      lastClusterId: null,
      setLastClusterId: (id) => set({ lastClusterId: id }),

      commandOpen: false,
      setCommandOpen: (v) => set({ commandOpen: v }),
    }),
    {
      name: 'kshui.ui',
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        refreshInterval: s.refreshInterval,
        lastClusterId: s.lastClusterId,
      }),
    },
  ),
);

/** react-query `refetchInterval` value (false when off). */
export function useRefetchInterval(): number | false {
  const ms = useUiStore((s) => s.refreshInterval);
  return ms === 0 ? false : ms;
}
