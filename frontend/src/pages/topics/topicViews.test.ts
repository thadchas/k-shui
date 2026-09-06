import { beforeEach, describe, expect, it } from 'vitest';
import type { TopicSummary } from '@/api/types';
import {
  BUILT_IN_TOPIC_VIEWS,
  columnWidth,
  createSavedView,
  DEFAULT_TOPIC_FILTERS,
  defaultColumnPrefs,
  findBuiltInView,
  getTopicHealth,
  isColumnVisible,
  isHighTrafficTopic,
  isUnhealthyTopic,
  loadColumnPrefs,
  loadSavedViews,
  persistColumnPrefs,
  persistSavedViews,
  removeSavedView,
  sanitizeColumnPrefs,
  sanitizeTopicFilters,
  TOPIC_COLUMNS,
  upsertSavedView,
  type SavedTopicView,
  type StorageLike,
} from './topicViews';

const topic = (over: Partial<TopicSummary> = {}): TopicSummary => ({
  name: 't1',
  partitions: 3,
  replicationFactor: 3,
  isInternal: false,
  underReplicatedPartitions: 0,
  sizeBytes: 1024,
  messageCount: 100,
  cleanupPolicy: 'delete',
  retentionMs: 604_800_000,
  hasSchema: { key: false, value: false },
  bytesInPerSec: 0,
  bytesOutPerSec: 0,
  ...over,
});

/** In-memory Storage stand-in so tests never touch real localStorage/jsdom quirks. */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('getTopicHealth / isUnhealthyTopic', () => {
  it('is healthy when there are no under-replicated partitions', () => {
    expect(getTopicHealth(topic({ underReplicatedPartitions: 0 }))).toBe('healthy');
    expect(isUnhealthyTopic(topic({ underReplicatedPartitions: 0 }))).toBe(false);
  });

  it('is unhealthy once any partition is under-replicated', () => {
    expect(getTopicHealth(topic({ underReplicatedPartitions: 1 }))).toBe('unhealthy');
    expect(isUnhealthyTopic(topic({ underReplicatedPartitions: 2 }))).toBe(true);
  });
});

describe('isHighTrafficTopic', () => {
  it('excludes idle topics with zero in/out throughput', () => {
    expect(isHighTrafficTopic(topic({ bytesInPerSec: 0, bytesOutPerSec: 0 }))).toBe(false);
    expect(isHighTrafficTopic(topic({ bytesInPerSec: null, bytesOutPerSec: null }))).toBe(false);
  });

  it('includes a topic with any measured produce or consume rate', () => {
    expect(isHighTrafficTopic(topic({ bytesInPerSec: 1, bytesOutPerSec: 0 }))).toBe(true);
    expect(isHighTrafficTopic(topic({ bytesInPerSec: null, bytesOutPerSec: 5 }))).toBe(true);
  });
});

describe('built-in views', () => {
  it('defines exactly Unhealthy and High traffic (Recently changed is intentionally omitted)', () => {
    const ids = BUILT_IN_TOPIC_VIEWS.map((v) => v.id);
    expect(ids).toEqual(['unhealthy', 'high-traffic']);
    expect(ids).not.toContain('recently-changed');
  });

  it('resolves a known id and predicate behavior for Unhealthy', () => {
    const view = findBuiltInView('unhealthy');
    expect(view).toBeDefined();
    expect(view!.predicate(topic({ underReplicatedPartitions: 1 }))).toBe(true);
    expect(view!.predicate(topic({ underReplicatedPartitions: 0 }))).toBe(false);
    expect(view!.filters).toEqual({ sort: 'underReplicatedPartitions', order: 'desc' });
  });

  it('resolves predicate behavior for High traffic', () => {
    const view = findBuiltInView('high-traffic');
    expect(view!.predicate(topic({ bytesInPerSec: 10 }))).toBe(true);
    expect(view!.predicate(topic({ bytesInPerSec: 0, bytesOutPerSec: 0 }))).toBe(false);
  });

  it('returns undefined for an unknown id', () => {
    expect(findBuiltInView('does-not-exist')).toBeUndefined();
    expect(findBuiltInView(null)).toBeUndefined();
    expect(findBuiltInView(undefined)).toBeUndefined();
  });
});

describe('sanitizeTopicFilters', () => {
  it('passes through a well-formed payload', () => {
    const input = { search: 'orders', showInternal: true, sort: 'sizeBytes', order: 'desc' };
    expect(sanitizeTopicFilters(input)).toEqual(input);
  });

  it('falls back per-field for missing or invalid values', () => {
    expect(sanitizeTopicFilters(null)).toEqual(DEFAULT_TOPIC_FILTERS);
    expect(sanitizeTopicFilters(undefined)).toEqual(DEFAULT_TOPIC_FILTERS);
    expect(sanitizeTopicFilters('garbage')).toEqual(DEFAULT_TOPIC_FILTERS);
    expect(
      sanitizeTopicFilters({ search: 42, showInternal: 'yes', sort: 'nope', order: 'sideways' }),
    ).toEqual(DEFAULT_TOPIC_FILTERS);
  });

  it('keeps valid fields while repairing only the invalid ones', () => {
    expect(sanitizeTopicFilters({ search: 'ok', sort: 'bogus' })).toEqual({
      ...DEFAULT_TOPIC_FILTERS,
      search: 'ok',
    });
  });
});

describe('column preferences', () => {
  it('defaults every column to its declared defaultWidth and visible', () => {
    const prefs = defaultColumnPrefs();
    for (const col of TOPIC_COLUMNS) {
      expect(columnWidth(prefs, col.id)).toBe(col.defaultWidth);
      expect(isColumnVisible(prefs, col.id)).toBe(true);
    }
  });

  it('pinned columns are always visible regardless of stored visibility', () => {
    const prefs = sanitizeColumnPrefs({ visibility: { name: false, health: false } });
    expect(isColumnVisible(prefs, 'name')).toBe(true);
    expect(isColumnVisible(prefs, 'health')).toBe(true);
  });

  it('clamps widths to the column min/max and drops unknown ids', () => {
    const prefs = sanitizeColumnPrefs({
      widths: { partitions: 1, sizeBytes: 999999, bogusColumn: 500 },
      visibility: { messageCount: false, bogusColumn: true },
    });
    const partitionsMeta = TOPIC_COLUMNS.find((c) => c.id === 'partitions')!;
    const sizeMeta = TOPIC_COLUMNS.find((c) => c.id === 'sizeBytes')!;
    expect(columnWidth(prefs, 'partitions')).toBe(partitionsMeta.minWidth);
    expect(columnWidth(prefs, 'sizeBytes')).toBe(sizeMeta.maxWidth);
    expect(prefs.widths.bogusColumn).toBeUndefined();
    expect(prefs.visibility.bogusColumn).toBeUndefined();
    expect(isColumnVisible(prefs, 'messageCount')).toBe(false);
  });

  it('tolerates a corrupt (non-object) column prefs payload', () => {
    expect(sanitizeColumnPrefs('not json shaped')).toEqual(defaultColumnPrefs());
    expect(sanitizeColumnPrefs(null)).toEqual(defaultColumnPrefs());
    expect(sanitizeColumnPrefs(42)).toEqual(defaultColumnPrefs());
  });
});

describe('saved views: round-trip and corruption tolerance', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('creates, saves, and reloads a saved view unchanged', () => {
    const filters = {
      search: 'orders',
      showInternal: true,
      sort: 'sizeBytes',
      order: 'desc',
    } as const;
    const columns = sanitizeColumnPrefs({
      widths: { partitions: 120 },
      visibility: { retentionMs: false },
    });
    const view = createSavedView('Big compacted topics', filters, columns, 'fixed-id-1');

    persistSavedViews('cluster-a', [view], storage);
    const reloaded = loadSavedViews('cluster-a', storage);

    expect(reloaded).toEqual([view]);
  });

  it('keeps views scoped per cluster', () => {
    const view = createSavedView('A-only', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-a');
    persistSavedViews('cluster-a', [view], storage);

    expect(loadSavedViews('cluster-a', storage)).toHaveLength(1);
    expect(loadSavedViews('cluster-b', storage)).toEqual([]);
  });

  it('upsertSavedView replaces by id and appends otherwise (pure, no storage mutation)', () => {
    const v1 = createSavedView('First', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-1');
    const v1Renamed = { ...v1, name: 'First renamed' };
    const v2 = createSavedView('Second', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-2');

    const afterAppend = upsertSavedView([v1], v2);
    expect(afterAppend).toEqual([v1, v2]);

    const afterReplace = upsertSavedView(afterAppend, v1Renamed);
    expect(afterReplace).toEqual([v1Renamed, v2]);
    // original array is untouched
    expect(afterAppend[0]).toEqual(v1);
  });

  it('removeSavedView drops the matching id and is a no-op otherwise', () => {
    const v1 = createSavedView('First', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-1');
    const v2 = createSavedView('Second', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-2');
    expect(removeSavedView([v1, v2], 'id-1')).toEqual([v2]);
    expect(removeSavedView([v1, v2], 'missing')).toEqual([v1, v2]);
  });

  it('tolerates a corrupt JSON payload and returns an empty list', () => {
    storage.setItem('kshui.topics.savedViews.cluster-a', '{not valid json');
    expect(loadSavedViews('cluster-a', storage)).toEqual([]);
  });

  it('tolerates a payload that is valid JSON but the wrong shape', () => {
    storage.setItem('kshui.topics.savedViews.cluster-a', JSON.stringify({ oops: 'not an array' }));
    expect(loadSavedViews('cluster-a', storage)).toEqual([]);

    storage.setItem('kshui.topics.savedViews.cluster-a', JSON.stringify([1, 'two', null, {}]));
    expect(loadSavedViews('cluster-a', storage)).toEqual([]);
  });

  it('drops individually malformed entries but keeps valid ones in a mixed array', () => {
    const good = createSavedView('Good', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs(), 'id-good');
    storage.setItem(
      'kshui.topics.savedViews.cluster-a',
      JSON.stringify([good, { id: '', name: 'no id' }, { name: 'missing id field' }, 'garbage']),
    );
    const reloaded = loadSavedViews('cluster-a', storage);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe('id-good');
  });

  it('repairs a saved view whose stored filters/columns are individually corrupt', () => {
    const raw = [
      {
        id: 'id-1',
        name: 'Half corrupt',
        createdAt: 123,
        filters: { search: 'ok', sort: 'not-a-real-sort-key' },
        columns: { widths: { partitions: -50 } },
      },
    ];
    storage.setItem('kshui.topics.savedViews.cluster-a', JSON.stringify(raw));
    const [view] = loadSavedViews('cluster-a', storage);
    expect(view.filters.search).toBe('ok');
    expect(view.filters.sort).toBe(DEFAULT_TOPIC_FILTERS.sort);
    const partitionsMeta = TOPIC_COLUMNS.find((c) => c.id === 'partitions')!;
    expect(columnWidth(view.columns, 'partitions')).toBe(partitionsMeta.minWidth);
  });
});

describe('column prefs persistence: round-trip and corruption tolerance', () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('round-trips a saved preference set', () => {
    const prefs = sanitizeColumnPrefs({
      widths: { partitions: 130, sizeBytes: 150 },
      visibility: { retentionMs: false, cleanupPolicy: false },
    });
    persistColumnPrefs('cluster-a', prefs, storage);
    expect(loadColumnPrefs('cluster-a', storage)).toEqual(prefs);
  });

  it('falls back to defaults for a missing key', () => {
    expect(loadColumnPrefs('never-saved', storage)).toEqual(defaultColumnPrefs());
  });

  it('tolerates corrupt JSON and returns defaults', () => {
    storage.setItem('kshui.topics.columnPrefs.cluster-a', 'not json at all {{{');
    expect(loadColumnPrefs('cluster-a', storage)).toEqual(defaultColumnPrefs());
  });
});

describe('SavedTopicView type shape sanity', () => {
  it('createSavedView trims the name and stamps a createdAt', () => {
    const before = Date.now();
    const view: SavedTopicView = createSavedView(
      '  Padded name  ',
      DEFAULT_TOPIC_FILTERS,
      defaultColumnPrefs(),
    );
    expect(view.name).toBe('Padded name');
    expect(view.createdAt).toBeGreaterThanOrEqual(before);
    expect(view.id).toBeTruthy();
  });

  it('generates distinct ids for views created back to back', () => {
    const a = createSavedView('A', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs());
    const b = createSavedView('B', DEFAULT_TOPIC_FILTERS, defaultColumnPrefs());
    expect(a.id).not.toBe(b.id);
  });
});
