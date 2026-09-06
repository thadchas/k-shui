import { NavLink, useLocation } from 'react-router';
import { ChevronLeft, PanelLeft, Pin, PinOff } from 'lucide-react';
import type { FeatureFlags } from '@/api/types';
import { ADMIN_NAV, NAV_GROUPS, isFeatureEnabled, navHref, type NavItem } from '@/lib/nav';
import { RESOURCE_TYPE_ICONS, RESOURCE_TYPE_LABELS } from '@/lib/scope';
import { cn } from '@/lib/utils';
import { useRecentsStore, type ResourceEntry } from '@/stores/recents';
import { useUiStore } from '@/stores/ui';
import { BrandMark } from '@/components/brand-mark';
import { ClusterSwitcher } from '@/components/ClusterSwitcher';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useClusterResources } from './useRecentResources';

interface SidebarLinkProps {
  item: NavItem;
  clusterId: string | null;
  collapsed: boolean;
  enabled: boolean;
}

function SidebarLink({ item, clusterId, collapsed, enabled }: SidebarLinkProps) {
  const href = navHref(item, clusterId);
  const Icon = item.icon;
  const location = useLocation();
  const active = location.pathname === href || location.pathname.startsWith(`${href}/`);

  const content = (
    <span
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-sm transition-colors',
        collapsed && 'w-9 justify-center px-0',
        !enabled && 'cursor-not-allowed opacity-45',
        enabled && active
          ? 'bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] font-medium text-[var(--primary)]'
          : enabled
            ? 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]'
            : 'text-[var(--muted)]',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </span>
  );

  if (!enabled) {
    return (
      <li>
        <Tooltip content={`${item.label} is not configured for this cluster`} side="right">
          <div aria-disabled="true">{content}</div>
        </Tooltip>
      </li>
    );
  }

  return (
    <li>
      {collapsed ? (
        <Tooltip content={item.label} side="right">
          <NavLink to={href} className="block focus-visible:outline-none">
            {content}
          </NavLink>
        </Tooltip>
      ) : (
        <NavLink to={href} className="block focus-visible:outline-none">
          {content}
        </NavLink>
      )}
    </li>
  );
}

interface ResourceRowProps {
  entry: ResourceEntry;
  collapsed: boolean;
  pinned: boolean;
  onTogglePin: (entry: ResourceEntry) => void;
}

function ResourceRow({ entry, collapsed, pinned, onTogglePin }: ResourceRowProps) {
  const Icon = RESOURCE_TYPE_ICONS[entry.type];
  const typeLabel = RESOURCE_TYPE_LABELS[entry.type];
  const location = useLocation();
  const active = location.pathname === entry.path;

  const link = (
    <NavLink
      to={entry.path}
      className={cn(
        'flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-sm transition-colors focus-visible:outline-none',
        collapsed && 'w-9 flex-none justify-center px-0',
        active
          ? 'bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] font-medium text-[var(--primary)]'
          : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span className="truncate font-mono text-xs">{entry.name}</span> : null}
    </NavLink>
  );

  if (collapsed) {
    return (
      <li className="flex justify-center">
        <Tooltip content={`${typeLabel} · ${entry.name}`} side="right">
          {link}
        </Tooltip>
      </li>
    );
  }

  return (
    <li className="group/resource flex items-center gap-0.5">
      <Tooltip content={`${typeLabel} · ${entry.name}`} side="right">
        {link}
      </Tooltip>
      <button
        type="button"
        onClick={() => onTogglePin(entry)}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${typeLabel.toLowerCase()} ${entry.name}`}
        aria-pressed={pinned}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] focus-visible:opacity-100',
          pinned
            ? 'text-[var(--primary)] opacity-100'
            : 'opacity-0 group-hover/resource:opacity-100 group-focus-within/resource:opacity-100',
        )}
      >
        {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
    </li>
  );
}

interface ResourceSectionProps {
  label: string;
  entries: ResourceEntry[];
  collapsed: boolean;
  pinned: boolean;
  onTogglePin: (entry: ResourceEntry) => void;
}

function ResourceSection({ label, entries, collapsed, pinned, onTogglePin }: ResourceSectionProps) {
  if (entries.length === 0) return null;
  return (
    <div className="mb-4">
      {!collapsed ? (
        <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label}
        </p>
      ) : (
        <div className="mb-1 h-px bg-[var(--border)]" />
      )}
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <ResourceRow
            key={`${entry.type}:${entry.path}`}
            entry={entry}
            collapsed={collapsed}
            pinned={pinned}
            onTogglePin={onTogglePin}
          />
        ))}
      </ul>
    </div>
  );
}

export interface SidebarProps {
  clusterId: string | null;
  features: Partial<FeatureFlags> | undefined;
  version?: string | null;
  /** `drawer` renders the full (never collapsed) nav inside the mobile Sheet. */
  variant?: 'rail' | 'drawer';
  className?: string;
}

export function Sidebar({
  clusterId,
  features,
  version,
  variant = 'rail',
  className,
}: SidebarProps) {
  const persistedCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const isDrawer = variant === 'drawer';
  const collapsed = isDrawer ? false : persistedCollapsed;

  const togglePin = useRecentsStore((s) => s.togglePin);
  const { pinned, recent } = useClusterResources(clusterId);

  // On a global route (Alerts, Audit, Clusters, app settings) there is no cluster in the
  // URL, which would leave every cluster-scoped link pointing at the cluster list. Fall
  // back to the last visited cluster, and say so in the rail rather than doing it silently.
  const lastClusterId = useUiStore((s) => s.lastClusterId);
  const navClusterId = clusterId ?? lastClusterId;
  const showFallbackNote = !clusterId && Boolean(lastClusterId) && !collapsed;

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        'flex h-dvh shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-150',
        collapsed ? 'w-16' : 'w-[248px]',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-[var(--border)] px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <NavLink
          to="/clusters"
          className="flex items-center gap-2 focus-visible:outline-none"
          aria-label="k-shui home"
        >
          <BrandMark />
          {!collapsed ? <span className="text-sm font-semibold tracking-tight">k-shui</span> : null}
        </NavLink>
      </div>

      <div className={cn('p-3', collapsed && 'flex justify-center px-0')}>
        <ClusterSwitcher clusterId={clusterId} collapsed={collapsed} />
        {showFallbackNote ? (
          <p className="mt-2 px-0.5 text-2xs leading-4 text-[var(--muted)]">
            Viewing all clusters. Cluster pages open{' '}
            <span className="font-mono">{lastClusterId}</span>.
          </p>
        ) : null}
      </div>

      <nav className={cn('min-h-0 flex-1 overflow-y-auto px-3 pb-3', collapsed && 'px-3.5')}>
        <ResourceSection
          label="Pinned"
          entries={pinned}
          collapsed={collapsed}
          pinned
          onTogglePin={togglePin}
        />
        {/* The collapsed rail has no room for names; recents stay behind the expanded nav. */}
        <ResourceSection
          label="Recent"
          entries={collapsed ? [] : recent}
          collapsed={collapsed}
          pinned={false}
          onTogglePin={togglePin}
        />

        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed ? (
              <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {group.label}
              </p>
            ) : (
              <div className="mb-1 h-px bg-[var(--border)]" />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink
                  key={item.label}
                  item={item}
                  clusterId={navClusterId}
                  collapsed={collapsed}
                  enabled={isFeatureEnabled(item, features)}
                />
              ))}
            </ul>
          </div>
        ))}

        <div className="mb-2">
          {!collapsed ? (
            <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Admin
            </p>
          ) : (
            <div className="mb-1 h-px bg-[var(--border)]" />
          )}
          <ul className="space-y-0.5">
            {ADMIN_NAV.map((item) => (
              <SidebarLink
                key={item.label}
                item={item}
                clusterId={navClusterId}
                collapsed={collapsed}
                enabled
              />
            ))}
          </ul>
        </div>
      </nav>

      <div
        className={cn(
          'flex items-center gap-2 border-t border-[var(--border)] p-3',
          collapsed && 'flex-col justify-center',
        )}
      >
        {!isDrawer ? (
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle sidebar">
              {collapsed ? <PanelLeft /> : <ChevronLeft />}
            </Button>
          </Tooltip>
        ) : null}
        {!collapsed ? (
          <span className="ml-auto font-mono text-2xs text-[var(--muted)]">
            {version ? `v${version}` : ''}
          </span>
        ) : null}
      </div>
    </aside>
  );
}
