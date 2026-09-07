import { Link, useLocation, useMatches, useNavigate } from 'react-router';
import { Boxes, Globe, LogOut, Menu, Search, User as UserIcon } from 'lucide-react';
import type { ClusterSummary, InfoResponse } from '@/api/types';
import { useLogout, useMe } from '@/api/hooks/system';
import { classifyRoute } from '@/lib/scope';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { AlertsBell } from '@/components/AlertsBell';
import { RefreshInterval } from '@/components/RefreshInterval';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';

export interface RouteHandle {
  /** Static crumb label, or a function of the route params. */
  crumb?: string | ((params: Record<string, string | undefined>) => string);
}

interface MatchWithHandle {
  id: string;
  pathname: string;
  params: Record<string, string | undefined>;
  handle?: RouteHandle;
}

export interface TopbarProps {
  clusterId: string | null;
  cluster?: ClusterSummary;
  info?: InfoResponse;
  /** Opens the mobile navigation drawer (rendered under `md`). */
  onOpenMenu?: () => void;
}

/**
 * Says out loud what the current view covers: one cluster, or every cluster. Global
 * pages (Alerts, Audit, Clusters, app settings) aggregate across clusters, and reading
 * them as if they were scoped to the last visited cluster is the mistake this prevents.
 */
function ScopeIndicator({
  pathname,
  clusterId,
  cluster,
}: {
  pathname: string;
  clusterId: string | null;
  cluster?: ClusterSummary;
}) {
  const scope = classifyRoute(pathname);
  const isCluster = scope.kind === 'cluster' && Boolean(clusterId);
  const name = cluster?.name ?? clusterId ?? '';
  const Icon = isCluster ? Boxes : Globe;

  return (
    <span
      className={cn(
        'hidden h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-2xs font-medium sm:inline-flex',
        isCluster
          ? 'border-transparent bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]'
          : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]',
      )}
      title={
        isCluster
          ? `Scope: cluster ${name}. Only this cluster's data is shown.`
          : 'Scope: all clusters. This view aggregates every configured cluster.'
      }
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Scope: </span>
      <span className="max-w-[12rem] truncate">{isCluster ? name : 'All clusters'}</span>
    </span>
  );
}

export function Topbar({ clusterId, cluster, info, onOpenMenu }: TopbarProps) {
  const matches = useMatches() as unknown as MatchWithHandle[];
  const location = useLocation();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const localUser = useAuthStore((s) => s.user);
  const authEnabled = info?.auth?.enabled ?? false;
  // `/auth/me` is the source of truth for role once signed in (OIDC sessions never hit
  // the login mutation, so the persisted user may be empty).
  const me = useMe(authEnabled);
  const user = me.data ?? info?.auth?.user ?? localUser;
  const logout = useLogout();
  const navigate = useNavigate();

  const crumbs: BreadcrumbItem[] = [];
  if (clusterId) {
    crumbs.push({ label: cluster?.name ?? clusterId, to: `/c/${clusterId}/overview` });
  }
  for (const match of matches) {
    const crumb = match.handle?.crumb;
    if (!crumb) continue;
    const label = typeof crumb === 'function' ? crumb(match.params) : crumb;
    if (!label) continue;
    crumbs.push({ label, to: match.pathname });
  }

  // Under `md` only the last crumb fits; the drawer covers the rest of the hierarchy.
  const allCrumbs = crumbs.length > 0 ? crumbs : [{ label: 'k-shui' }];
  const tailCrumbs = allCrumbs.slice(-1);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-3 backdrop-blur-md md:gap-3 md:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMenu}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>
      <Breadcrumb items={allCrumbs} className="hidden min-w-0 flex-1 md:flex" />
      <Breadcrumb items={tailCrumbs} className="min-w-0 flex-1 md:hidden" />

      <ScopeIndicator pathname={location.pathname} clusterId={clusterId} cluster={cluster} />

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className={cn(
          'hidden h-8 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-xs text-[var(--muted)] transition-colors',
          'hover:border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] hover:text-[var(--foreground)] md:flex',
        )}
        aria-label="Open command palette"
      >
        <Search className="size-3.5" />
        <span className="w-32 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setCommandOpen(true)}
        aria-label="Search"
      >
        <Search />
      </Button>

      <AlertsBell />
      <RefreshInterval scope={clusterId ? ['cluster', clusterId] : undefined} />
      <ThemeToggle />

      {authEnabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account">
              <UserIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{user?.username ?? 'Account'}</DropdownMenuLabel>
            {user?.role ? (
              <p className="px-2 pb-1 text-2xs capitalize text-[var(--muted)]">{user.role}</p>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onSelect={() => {
                logout.mutate(undefined, { onSettled: () => void navigate('/login') });
              }}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );
}
