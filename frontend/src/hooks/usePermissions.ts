import { useInfo } from '@/api/hooks/system';
import type { UserRole } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

export interface Permissions {
  /** Resolved role. `admin` when auth is disabled (everyone is an operator). */
  role: UserRole;
  /** May create / update / delete resources (editor or admin). */
  canEdit: boolean;
  isAdmin: boolean;
  /** True while `/info` has not answered yet — callers may want to avoid flashing disabled controls. */
  loading: boolean;
}

/** Tooltip text to attach to a control that is disabled because `!canEdit`. */
export const REQUIRES_EDITOR = 'Requires editor role';

/**
 * Role derived from `/info` (`auth.user`), falling back to the persisted login user.
 *
 * ```tsx
 * const { canEdit } = usePermissions();
 * <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
 *   <span><Button disabled={!canEdit}>Delete</Button></span>
 * </Tooltip>
 * ```
 */
export function usePermissions(): Permissions {
  const { data: info, isLoading } = useInfo();
  const localUser = useAuthStore((s) => s.user);

  const loading = !info;
  const user = info?.auth.user ?? localUser ?? null;
  // Until `/info` answers we have nothing to go on: if a login user is known use their role,
  // otherwise assume full access so controls do not flash disabled on every page load (the
  // server enforces roles regardless). Once `/info` is in, its answer wins.
  const role: UserRole = info
    ? info.auth.enabled
      ? (user?.role ?? 'viewer')
      : 'admin'
    : (localUser?.role ?? 'admin');

  return {
    role,
    canEdit: role === 'admin' || role === 'editor',
    isAdmin: role === 'admin',
    loading: loading && isLoading,
  };
}
