/**
 * Pure logic for the Topics page "views" feature: built-in preset predicates, and
 * serialization/persistence of user-named saved views and column preferences.
 *
 * Kept free of React and DOM globals (besides an injectable `StorageLike`) so it can be
 * unit tested directly — see topicViews.test.ts.
 */
import type { TopicSummary } from '@/api/types';

/* --------------------------------- filters -------------------------------- */

export const SORT_KEYS = [
  'name',
  'partitions',
  'replicationFactor',
  'underReplicatedPartitions',
  'sizeBytes',
  'messageCount',
  'cleanupPolicy',
  'retentionMs',
  'bytesInPerSec',
  'bytesOutPerSec',
] as const;
export type TopicSortKey = (typeof SORT_KEYS)[number];

export const ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof ORDERS)[number];

export interface TopicListFilters {
  search: string;
  showInternal: boolean;
  sort: TopicSortKey;
  order: SortOrder;
}

export const DEFAULT_TOPIC_FILTERS: TopicListFilters = {
  search: '',
  showInternal: false,
  sort: 'name',
  order: 'asc',
};

function isSortKey(v: unknown): v is TopicSortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

function isOrder(v: unknown): v is SortOrder {
  return typeof v === 'string' && (ORDERS as readonly string[]).includes(v);
}

/** Tolerant of missing/malformed fields — falls back per-field to `fallback`. */
export function sanitizeTopicFilters(
  raw: unknown,
  fallback: TopicListFilters = DEFAULT_TOPIC_FILTERS,
): TopicListFilters {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const r = raw as Record<string, unknown>;
  return {
    search: typeof r.search === 'string' ? r.search : fallback.search,
    showInternal: typeof r.showInternal === 'boolean' ? r.showInternal : fallback.showInternal,
    sort: isSortKey(r.sort) ? r.sort : fallback.sort,
    order: isOrder(r.order) ? r.order : fallback.order,
  };
}

/* ------------------------------- health / traffic -------------------------- */

export type TopicHealth = 'healthy' | 'unhealthy';

/**
 * `TopicSummary` only exposes `underReplicatedPartitions`; offline-partition and
 * min-ISR-breach counts are not part of the topic list contract (see api/types.ts), so
 * they cannot be evaluated here. See `BUILT_IN_TOPIC_VIEWS` doc for the resulting
 * limitation on the "Unhealthy" preset.
 */
export function getTopicHealth(
  topic: Pick<TopicSummary, 'underReplicatedPartitions'>,
): TopicHealth {
  return topic.underReplicatedPartitions > 0 ? 'unhealthy' : 'healthy';
}

export function isUnhealthyTopic(topic: Pick<TopicSummary, 'underReplicatedPartitions'>): boolean {
  return getTopicHealth(topic) === 'unhealthy';
}

/** Idle topics (no measured produce/consume rate) are excluded from "High traffic". */
export function isHighTrafficTopic(
  topic: Pick<TopicSummary, 'bytesInPerSec' | 'bytesOutPerSec'>,
): boolean {
  const rate = (topic.bytesInPerSec ?? 0) + (topic.bytesOutPerSec ?? 0);
  return rate > 0;
}

/* ------------------------------- built-in views ----------------------------- */

export interface BuiltInTopicView {
  id: string;
  name: string;
  /** Shown as help text / tooltip next to the view in the picker. */
  description: string;
  filters: Partial<TopicListFilters>;
  /**
   * Applied client-side to the currently loaded page of results. The topics API has no
   * server-side health/traffic filter (`TopicListQuery` only supports search/sort/paging),
   * so this only narrows what is already on the page rather than searching every topic in
   * the cluster — see the limitation note in TopicsPage.
   */
  predicate: (topic: TopicSummary) => boolean;
}

export const BUILT_IN_TOPIC_VIEWS: readonly BuiltInTopicView[] = [
  {
    id: 'unhealthy',
    name: 'Unhealthy',
    description:
      'Topics with under-replicated partitions, worst first. Offline-partition and min-ISR-breach counts are not exposed by the topic list API and are not evaluated.',
    filters: { sort: 'underReplicatedPartitions', order: 'desc' },
    predicate: isUnhealthyTopic,
  },
  {
    id: 'high-traffic',
    name: 'High traffic',
    description:
      'Topics with non-zero produce or consume throughput, highest combined bytes/sec first. Idle topics are hidden.',
    filters: { sort: 'bytesInPerSec', order: 'desc' },
    predicate: isHighTrafficTopic,
  },
  // "Recently changed" is intentionally omitted: TopicSummary / TopicDetail carry no
  // last-modified or created-at timestamp, so a recency preset would have to fake it.
] as const;

export function findBuiltInView(id: string | null | undefined): BuiltInTopicView | undefined {
  return BUILT_IN_TOPIC_VIEWS.find((v) => v.id === id);
}

/* -------------------------------- columns ----------------------------------- */

export interface TopicColumnMeta {
  id: string;
  /** Full label used in the columns menu and as the expanded header tooltip/title. */
  label: string;
  /** Abbreviated table header text; falls back to `label` when absent. */
  shortLabel?: string;
  /** Sticky (pinned) columns are always visible and not user-resizable. */
  pinned?: boolean;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export const TOPIC_COLUMNS: readonly TopicColumnMeta[] = [
  {
    id: 'name',
    label: 'Topic name',
    pinned: true,
    defaultWidth: 260,
    minWidth: 260,
    maxWidth: 260,
  },
  { id: 'health', label: 'Health', pinned: true, defaultWidth: 130, minWidth: 130, maxWidth: 130 },
  {
    id: 'partitions',
    label: 'Partitions',
    shortLabel: 'Parts',
    defaultWidth: 90,
    minWidth: 60,
    maxWidth: 200,
  },
  {
    id: 'replicationFactor',
    label: 'Replication factor',
    shortLabel: 'RF',
    defaultWidth: 70,
    minWidth: 50,
    maxWidth: 200,
  },
  {
    id: 'underReplicatedPartitions',
    label: 'Under-replicated partitions',
    shortLabel: 'URP',
    defaultWidth: 80,
    minWidth: 60,
    maxWidth: 200,
  },
  { id: 'sizeBytes', label: 'Size', defaultWidth: 110, minWidth: 80, maxWidth: 220 },
  { id: 'messageCount', label: 'Messages', defaultWidth: 110, minWidth: 70, maxWidth: 220 },
  {
    id: 'cleanupPolicy',
    label: 'Cleanup policy',
    shortLabel: 'Cleanup',
    defaultWidth: 152,
    minWidth: 110,
    maxWidth: 260,
  },
  { id: 'retentionMs', label: 'Retention', defaultWidth: 110, minWidth: 80, maxWidth: 240 },
  {
    id: 'bytesInPerSec',
    label: 'Bytes in per second',
    shortLabel: 'In',
    defaultWidth: 110,
    minWidth: 70,
    maxWidth: 220,
  },
  {
    id: 'bytesOutPerSec',
    label: 'Bytes out per second',
    shortLabel: 'Out',
    defaultWidth: 110,
    minWidth: 70,
    maxWidth: 220,
  },
] as const;

export const HIDEABLE_TOPIC_COLUMNS: readonly TopicColumnMeta[] = TOPIC_COLUMNS.filter(
  (c) => !c.pinned,
);

export interface TopicColumnPrefs {
  /** Column id -> visible. Absent id defaults to visible. Pinned columns are never hidden. */
  visibility: Record<string, boolean>;
  /** Column id -> width in px. Absent id falls back to that column's `defaultWidth`. */
  widths: Record<string, number>;
}

export function defaultColumnPrefs(): TopicColumnPrefs {
  return { visibility: {}, widths: {} };
}

function clampWidth(id: string, width: number): number {
  const meta = TOPIC_COLUMNS.find((c) => c.id === id);
  if (!meta || !Number.isFinite(width)) return meta?.defaultWidth ?? 100;
  return Math.min(meta.maxWidth, Math.max(meta.minWidth, Math.round(width)));
}

export function columnWidth(prefs: TopicColumnPrefs, id: string): number {
  const meta = TOPIC_COLUMNS.find((c) => c.id === id);
  const raw = prefs.widths[id];
  return typeof raw === 'number' ? clampWidth(id, raw) : (meta?.defaultWidth ?? 100);
}

export function isColumnVisible(prefs: TopicColumnPrefs, id: string): boolean {
  const meta = TOPIC_COLUMNS.find((c) => c.id === id);
  if (meta?.pinned) return true;
  return prefs.visibility[id] !== false;
}

/** Tolerant merge: unknown ids are dropped, widths are clamped, missing fields default. */
export function sanitizeColumnPrefs(raw: unknown): TopicColumnPrefs {
  const out = defaultColumnPrefs();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const knownIds = new Set(TOPIC_COLUMNS.map((c) => c.id));

  if (r.visibility && typeof r.visibility === 'object') {
    for (const [id, v] of Object.entries(r.visibility as Record<string, unknown>)) {
      if (knownIds.has(id) && typeof v === 'boolean') out.visibility[id] = v;
    }
  }
  if (r.widths && typeof r.widths === 'object') {
    for (const [id, v] of Object.entries(r.widths as Record<string, unknown>)) {
      if (knownIds.has(id) && typeof v === 'number') out.widths[id] = clampWidth(id, v);
    }
  }
  return out;
}

/* --------------------------------- storage ----------------------------------- */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    // Corrupt payload (bad JSON, quota-evicted partial write, foreign format, etc.) — treat
    // as absent rather than throwing.
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private-mode storage — persistence is a convenience only.
  }
}

const savedViewsKey = (clusterId: string) => `kshui.topics.savedViews.${clusterId}`;
const columnPrefsKey = (clusterId: string) => `kshui.topics.columnPrefs.${clusterId}`;

/* ------------------------------- saved views ---------------------------------- */

export interface SavedTopicView {
  id: string;
  name: string;
  createdAt: number;
  filters: TopicListFilters;
  columns: TopicColumnPrefs;
}

function sanitizeSavedView(raw: unknown): SavedTopicView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  return {
    id: r.id,
    name: r.name,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    filters: sanitizeTopicFilters(r.filters),
    columns: sanitizeColumnPrefs(r.columns),
  };
}

/** Tolerant of a missing key, corrupt JSON, or a payload that isn't the expected shape. */
export function loadSavedViews(
  clusterId: string,
  storage: StorageLike | null = getDefaultStorage(),
): SavedTopicView[] {
  const parsed = readJson(storage, savedViewsKey(clusterId));
  if (!Array.isArray(parsed)) return [];
  const out: SavedTopicView[] = [];
  for (const item of parsed) {
    const v = sanitizeSavedView(item);
    if (v) out.push(v);
  }
  return out;
}

export function persistSavedViews(
  clusterId: string,
  views: SavedTopicView[],
  storage: StorageLike | null = getDefaultStorage(),
): void {
  writeJson(storage, savedViewsKey(clusterId), views);
}

let savedViewCounter = 0;

/** Deterministic-enough id generator (no crypto.randomUUID dependency). */
export function createSavedView(
  name: string,
  filters: TopicListFilters,
  columns: TopicColumnPrefs,
  id?: string,
): SavedTopicView {
  savedViewCounter += 1;
  return {
    id:
      id ??
      `${Date.now().toString(36)}-${savedViewCounter}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    createdAt: Date.now(),
    filters,
    columns,
  };
}

/** Pure: replaces an existing view with the same id, otherwise appends. */
export function upsertSavedView(views: SavedTopicView[], view: SavedTopicView): SavedTopicView[] {
  const idx = views.findIndex((v) => v.id === view.id);
  if (idx === -1) return [...views, view];
  const next = views.slice();
  next[idx] = view;
  return next;
}

/** Pure: drops the view with the given id (no-op if absent). */
export function removeSavedView(views: SavedTopicView[], id: string): SavedTopicView[] {
  return views.filter((v) => v.id !== id);
}

/* ------------------------------ column preferences ------------------------------ */

export function loadColumnPrefs(
  clusterId: string,
  storage: StorageLike | null = getDefaultStorage(),
): TopicColumnPrefs {
  return sanitizeColumnPrefs(readJson(storage, columnPrefsKey(clusterId)));
}

export function persistColumnPrefs(
  clusterId: string,
  prefs: TopicColumnPrefs,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  writeJson(storage, columnPrefsKey(clusterId), prefs);
}
