import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/api/types';

interface AuthState {
  token: string | null;
  user: User | null;
  setSession: (token: string | null, user: User | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'kshui.auth' },
  ),
);

/** Non-reactive read for the fetch layer. */
export function getAuthToken(): string | null {
  return useAuthStore.getState().token;
}
