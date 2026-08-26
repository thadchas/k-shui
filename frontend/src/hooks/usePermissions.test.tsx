import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useInfo = vi.fn();
vi.mock('@/api/hooks/system', () => ({ useInfo: () => useInfo() }));
vi.mock('@/stores/auth', () => ({
  useAuthStore: (sel: (s: { user: null }) => unknown) => sel({ user: null }),
}));

import { usePermissions, REQUIRES_EDITOR } from './usePermissions';

const info = (auth: Record<string, unknown>) => ({ data: { auth }, isLoading: false });

describe('usePermissions', () => {
  it('treats everyone as admin when auth is disabled', () => {
    useInfo.mockReturnValue(info({ enabled: false, user: null }));
    const { result } = renderHook(() => usePermissions());
    expect(result.current).toMatchObject({ role: 'admin', canEdit: true, isAdmin: true });
  });
  it('viewer cannot edit', () => {
    useInfo.mockReturnValue(info({ enabled: true, user: { username: 'v', role: 'viewer' } }));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canEdit).toBe(false);
    expect(result.current.isAdmin).toBe(false);
  });
  it('editor can edit but is not admin', () => {
    useInfo.mockReturnValue(info({ enabled: true, user: { username: 'e', role: 'editor' } }));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canEdit).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });
  it('defaults to viewer while auth is enabled but no user is known, and reports loading', () => {
    useInfo.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.role).toBe('viewer');
    expect(result.current.loading).toBe(true);
  });
  it('exposes the tooltip constant', () => {
    expect(REQUIRES_EDITOR).toMatch(/editor/i);
  });
});
