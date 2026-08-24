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

  const authEnabled = info?.auth.enabled ?? false;
  const user = info?.auth.user ?? localUser ?? null;
  const role: UserRole = !authEnabled && info ? 'admin' : (user?.role ?? 'viewer');

  return {
    role,
    canEdit: role === 'admin' || role === 'editor',
    isAdmin: role === 'admin',
    loading: isLoading && !info,
  };
}
