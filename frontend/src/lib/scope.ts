/**
 * Route scope + resource identity helpers.
 *
 * Two questions are answered here, both as pure functions so they can be unit tested
 * without a router:
 *
 *  1. "Where am I?" — is the current route scoped to one cluster, or global (Alerts,
 *     Audit, Clusters, app settings)? The Topbar renders that answer verbatim so an
 *     investigation view never hides its scope.
 *  2. "Where does this go when the cluster changes?" — switching cluster must never keep
 *     a resource context that belonged to the previous cluster (a topic called `orders`
 *     in cluster A is not the `orders` in cluster B), so a resource-detail route maps to
 *     its section list page in the target cluster.
 */
import { Cable, Database, Layers, Server, Users, Workflow, type LucideIcon } from 'lucide-react';
import { ADMIN_NAV, NAV_GROUPS } from './nav';

export type ResourceType =
  'topic' | 'consumer-group' | 'schema' | 'connector' | 'flink-job' | 'broker';

/** A resource-detail destination, cluster-qualified. */
export interface ResourceRef {
  clusterId: string;
  type: ResourceType;
  /** Human-readable identifier (decoded). */
  name: string;
  /** Absolute app path (still URL-encoded, ready for `<Link to>`). */
  path: string;
}

export type RouteScope =
  { kind: 'cluster'; clusterId: string; section: string } | { kind: 'global'; section: string };

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  topic: 'Topic',
  'consumer-group': 'Consumer group',
  schema: 'Schema',
  connector: 'Connector',
  'flink-job': 'Flink job',
  broker: 'Broker',
};

export const RESOURCE_TYPE_ICONS: Record<ResourceType, LucideIcon> = {
  topic: Layers,
  'consumer-group': Users,
  schema: Database,
  connector: Cable,
  'flink-job': Workflow,
  broker: Server,
};

/** Sections that exist under `/c/:cluster`. Anything else falls back to `overview`. */
export const CLUSTER_SECTIONS: readonly string[] = [
  ...new Set([
    'overview',
    'brokers',
    ...NAV_GROUPS.flatMap((g) =>
      g.items.filter((i) => !i.global).map((i) => i.path.replace(/^\//, '')),
    ),
  ]),
];

/** Query params that describe the investigation window; carried across cluster switches. */
export const PRESERVED_SEARCH_PARAMS: readonly string[] = ['range', 'from', 'to'];

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `/c/:cluster/rest…` → `{ clusterId, rest }`; `null` for every other path. */
export function parseClusterPath(pathname: string): { clusterId: string; rest: string[] } | null {
  const parts = segments(pathname);
  if (parts[0] !== 'c' || !parts[1]) return null;
  return { clusterId: decode(parts[1]), rest: parts.slice(2) };
}

/** Cluster-scoped vs global, plus the leading section segment. */
export function classifyRoute(pathname: string): RouteScope {
  const parsed = parseClusterPath(pathname);
  if (parsed) {
    return { kind: 'cluster', clusterId: parsed.clusterId, section: parsed.rest[0] ?? 'overview' };
  }
  return { kind: 'global', section: segments(pathname)[0] ?? '' };
}

export function isGlobalRoute(pathname: string): boolean {
  return classifyRoute(pathname).kind === 'global';
}

/** Nav label for a section segment (`share-groups` → `Share groups`). */
export function sectionLabel(section: string): string {
  const path = `/${section}`;
  for (const group of NAV_GROUPS) {
    const hit = group.items.find((i) => i.path === path);
    if (hit) return hit.label;
  }
  const admin = ADMIN_NAV.find((i) => i.path === path);
  if (admin) return admin.label;
  if (!section) return 'k-shui';
  return section.charAt(0).toUpperCase() + section.slice(1).replace(/-/g, ' ');
}

/**
 * Recognise the resource-detail routes worth remembering. Creation routes (`topics/new`)
 * and list routes are deliberately not resources.
 */
export function matchResourceRoute(pathname: string): ResourceRef | null {
  const parsed = parseClusterPath(pathname);
  if (!parsed) return null;
  const { clusterId, rest } = parsed;
  const path = pathname.replace(/\/+$/, '') || pathname;

  const ref = (type: ResourceType, raw: string): ResourceRef | null => {
    const name = decode(raw);
    if (!name || name === 'new') return null;
    return { clusterId, type, name, path };
  };

  if (rest.length === 2) {
    if (rest[0] === 'topics') return ref('topic', rest[1]);
    if (rest[0] === 'consumers') return ref('consumer-group', rest[1]);
    if (rest[0] === 'schemas') return ref('schema', rest[1]);
    if (rest[0] === 'brokers') return ref('broker', rest[1]);
    return null;
  }
  if (rest.length === 4 && rest[0] === 'connect' && rest[2] === 'connectors') {
    return ref('connector', rest[3]);
  }
  if (rest.length === 4 && rest[0] === 'flink' && rest[2] === 'jobs') {
    return ref('flink-job', rest[3]);
  }
  return null;
}

/** Keep only the investigation-window params from a `location.search` string. */
export function preservedSearch(search: string | undefined): string {
  if (!search) return '';
  const source = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const kept = new URLSearchParams();
  for (const key of PRESERVED_SEARCH_PARAMS) {
    const value = source.get(key);
    if (value) kept.set(key, value);
  }
  const out = kept.toString();
  return out ? `?${out}` : '';
}

/**
 * Where a cluster switch should land.
 *
 * The section is preserved when it exists for every cluster; a resource-detail path
 * degrades to that section's list page so the new cluster never inherits the old
 * cluster's resource. Global routes (Alerts, Audit, Clusters, settings) have no
 * per-cluster equivalent, so they land on the target cluster's overview.
 */
export function clusterSwitchPath(pathname: string, targetClusterId: string, search = ''): string {
  const base = `/c/${encodeURIComponent(targetClusterId)}`;
  const parsed = parseClusterPath(pathname);
  const section = parsed?.rest[0] ?? '';
  const target =
    section && CLUSTER_SECTIONS.includes(section) ? `${base}/${section}` : `${base}/overview`;
  return `${target}${preservedSearch(search)}`;
}

/**
 * A short description of what a cluster switch drops, for the switcher UI. `null` when
 * nothing is lost (the current page maps across unchanged).
 */
export function clusterSwitchNotice(
  pathname: string,
): { resource: ResourceRef; section: string } | null {
  const resource = matchResourceRoute(pathname);
  if (!resource) return null;
  const section = parseClusterPath(pathname)?.rest[0] ?? 'overview';
  return { resource, section: sectionLabel(section) };
}
