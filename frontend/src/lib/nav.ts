import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Cable,
  Database,
  FileCode2,
  GitBranch,
  Layers,
  LayoutDashboard,
  ListTree,
  Repeat,
  ScrollText,
  Server,
  Settings,
  Shield,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureFlags } from '@/api/types';

export type FeatureKey = keyof FeatureFlags;

export interface NavItem {
  label: string;
  /** Path relative to `/c/:cluster` (leading slash), or an absolute app path. */
  path: string;
  icon: LucideIcon;
  /** When set, the item is disabled unless the cluster reports this feature. */
  feature?: FeatureKey;
  /** Global (non cluster-scoped) route. */
  global?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Cluster',
    items: [
      { label: 'Overview', path: '/overview', icon: LayoutDashboard },
      { label: 'Brokers', path: '/brokers', icon: Server },
      { label: 'Topics', path: '/topics', icon: Layers },
      { label: 'Consumers', path: '/consumers', icon: Users },
      { label: 'Security', path: '/security', icon: Shield },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
  {
    label: 'Streaming',
    items: [
      { label: 'Connect', path: '/connect', icon: Cable, feature: 'connect' },
      { label: 'ksqlDB', path: '/ksql', icon: FileCode2, feature: 'ksqldb' },
      { label: 'Flink', path: '/flink', icon: Workflow, feature: 'flink' },
      { label: 'Replication', path: '/replication', icon: Repeat },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Schemas', path: '/schemas', icon: Database, feature: 'schemaRegistry' },
      { label: 'Lineage', path: '/lineage', icon: GitBranch, feature: 'lineage' },
    ],
  },
  {
    label: 'Observability',
    items: [
      { label: 'Metrics', path: '/metrics', icon: BarChart3, feature: 'prometheus' },
      { label: 'Alerts', path: '/alerts', icon: Bell, global: true },
      { label: 'Audit', path: '/audit', icon: ScrollText, global: true },
    ],
  },
];

export const ADMIN_NAV: NavItem[] = [
  { label: 'Clusters', path: '/clusters', icon: Boxes, global: true },
  { label: 'App settings', path: '/settings', icon: Settings, global: true },
];

/** Resolve a NavItem to a concrete href. */
export function navHref(item: NavItem, clusterId: string | null): string {
  if (item.global) return item.path;
  if (!clusterId) return '/clusters';
  return `/c/${clusterId}${item.path}`;
}

export function isFeatureEnabled(
  item: NavItem,
  features: Partial<FeatureFlags> | undefined,
): boolean {
  if (!item.feature) return true;
  if (!features) return true; // unknown → don't punish discoverability
  return Boolean(features[item.feature]);
}

export const FEATURE_LABELS: Record<string, string> = {
  schemaRegistry: 'Schema Registry',
  connect: 'Kafka Connect',
  ksqldb: 'ksqlDB',
  flink: 'Flink',
  prometheus: 'Prometheus',
  lineage: 'Lineage',
};

export { Activity, ListTree };
