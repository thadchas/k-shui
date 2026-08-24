import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/api/types';

interface AuthState {
  token: string | null;
  user: User | null;
  /**
   * Set by the fetch layer when the server answers 401. `AppShell` reacts by
   * refetching `/info` and redirecting to `/login` (preserving `from`), then clears it.
   * Not persisted.
   */
  sessionExpired: boolean;
  setSession: (token: string | null, user: User | null) => void;
  clear: () => void;
  markSessionExpired: () => void;
  ackSessionExpired: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      sessionExpired: false,
      setSession: (token, user) => set({ token, user, sessionExpired: false }),
      clear: () => set({ token: null, user: null }),
      markSessionExpired: () => set({ token: null, user: null, sessionExpired: true }),
      ackSessionExpired: () => set({ sessionExpired: false }),
    }),
    {
      name: 'kshui.auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);

/** Non-reactive read for the fetch layer. */
export function getAuthToken(): string | null {
  return useAuthStore.getState().token;
}
