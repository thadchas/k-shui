import { describe, expect, it } from 'vitest';
import {
  advancedSummary,
  buildMessagesQuery,
  consumptionStatus,
  createSavedSearch,
  DEFAULT_QUERY_CONFIG,
  extractFieldValue,
  formatFieldValue,
  type MessageQueryConfig,
  parseFieldPath,
  parseSavedSearches,
  sanitizeQueryConfig,
  savedSearchesKey,
  serializeSavedSearches,
  suggestFieldPaths,
} from './messageSearch';

const config = (over: Partial<MessageQueryConfig> = {}): MessageQueryConfig => ({
  ...DEFAULT_QUERY_CONFIG,
  ...over,
});

describe('parseFieldPath', () => {
  it('splits dot paths and bracket indices', () => {
    expect(parseFieldPath('order.items[0].sku')).toEqual(['order', 'items', '0', 'sku']);
    expect(parseFieldPath('a.0.b')).toEqual(['a', '0', 'b']);
    expect(parseFieldPath('$.order.status')).toEqual(['order', 'status']);
    expect(parseFieldPath("meta['x']")).toEqual(['meta', 'x']);
  });

  it('rejects unusable paths', () => {
    expect(parseFieldPath('')).toEqual([]);
    expect(parseFieldPath('   ')).toEqual([]);
    expect(parseFieldPath('a..b')).toEqual([]);
    expect(parseFieldPath('a[]')).toEqual([]);
    expect(parseFieldPath('a[0]x')).toEqual([]);
  });
});

describe('extractFieldValue', () => {
  const payload = {
    order: { id: 7, status: 'PAID', items: [{ sku: 'A-1' }, { sku: 'B-2' }] },
    nullable: null,
    flag: false,
  };

  it('reads nested object and array paths', () => {
    expect(extractFieldValue(payload, 'order.status')).toBe('PAID');
    expect(extractFieldValue(payload, 'order.id')).toBe(7);
    expect(extractFieldValue(payload, 'order.items[1].sku')).toBe('B-2');
    expect(extractFieldValue(payload, 'order.items.0.sku')).toBe('A-1');
    expect(extractFieldValue(payload, 'flag')).toBe(false);
    expect(extractFieldValue(payload, 'nullable')).toBeNull();
  });

  it('returns undefined for missing paths and paths through primitives', () => {
    expect(extractFieldValue(payload, 'order.missing')).toBeUndefined();
    expect(extractFieldValue(payload, 'missing.deep.path')).toBeUndefined();
    expect(extractFieldValue(payload, 'order.status.length')).toBeUndefined();
    expect(extractFieldValue(payload, 'order.items[9].sku')).toBeUndefined();
    expect(extractFieldValue(payload, 'nullable.x')).toBeUndefined();
    expect(extractFieldValue(payload, '')).toBeUndefined();
  });

  it('parses JSON string payloads before walking', () => {
    expect(extractFieldValue('{"a":{"b":2}}', 'a.b')).toBe(2);
    expect(extractFieldValue('[{"b":3}]', '[0].b')).toBe(3);
  });

  it('returns undefined for non-JSON payloads', () => {
    expect(extractFieldValue('plain text log line', 'a.b')).toBeUndefined();
    expect(extractFieldValue('', 'a')).toBeUndefined();
    expect(extractFieldValue(null, 'a')).toBeUndefined();
    expect(extractFieldValue(undefined, 'a')).toBeUndefined();
    expect(extractFieldValue(42, 'a')).toBeUndefined();
  });
});

describe('formatFieldValue', () => {
  it('renders a dash for missing and JSON for containers', () => {
    expect(formatFieldValue(undefined)).toBe('—');
    expect(formatFieldValue(null)).toBe('null');
    expect(formatFieldValue('s')).toBe('s');
    expect(formatFieldValue(0)).toBe('0');
    expect(formatFieldValue(false)).toBe('false');
    expect(formatFieldValue({ a: [1] })).toBe('{"a":[1]}');
  });
});

describe('suggestFieldPaths', () => {
  it('collects leaf paths from sampled JSON values', () => {
    const paths = suggestFieldPaths([
      { value: { order: { id: 1, status: 'NEW' } } },
      { value: '{"user":{"email":"a@b.c"}}' },
      { value: 'not json' },
      { value: null },
    ]);
    expect(paths).toContain('order.id');
    expect(paths).toContain('order.status');
    expect(paths).toContain('user.email');
  });

  it('descends the first element of arrays and honours maxPaths', () => {
    expect(suggestFieldPaths([{ value: { items: [{ sku: 'x' }] } }])).toContain('items[0].sku');
    expect(suggestFieldPaths([{ value: { a: 1, b: 2, c: 3 } }], { maxPaths: 2 })).toHaveLength(2);
  });
});

describe('advancedSummary', () => {
  it('is inactive for the default configuration', () => {
    const summary = advancedSummary(DEFAULT_QUERY_CONFIG);
    expect(summary.active).toBe(false);
    expect(summary.count).toBe(0);
    expect(summary.items).toEqual([]);
  });

  it('counts every non-default advanced control', () => {
    const summary = advancedSummary(
      config({
        partitions: ['0', '3'],
        keyFormat: 'json',
        valueFormat: 'avro',
        limit: 500,
        filter: 'ERROR',
        filterMode: 'regex',
        filterTarget: 'value',
      }),
    );
    expect(summary.active).toBe(true);
    expect(summary.count).toBe(6);
    expect(summary.items[0]).toContain('Partitions: 2 selected');
    expect(summary.items).toContain('Key encoding: json');
    expect(summary.items).toContain('Value encoding: avro');
    expect(summary.items).toContain('Limit: 500');
    expect(summary.items).toContain('Match mode: regex');
    expect(summary.items).toContain('Search in: value');
  });

  it('ignores filter modes while the filter box is empty', () => {
    const summary = advancedSummary(config({ filterMode: 'regex', filterTarget: 'key' }));
    expect(summary.active).toBe(false);
  });

  it('counts per-partition offset overrides only in offset mode', () => {
    const overrides = { '0': '10', '1': '' };
    expect(
      advancedSummary(config({ mode: 'offset', perPartitionOffsets: overrides })).items,
    ).toContain('Per-partition offsets: 1 overridden');
    expect(advancedSummary(config({ mode: 'latest', perPartitionOffsets: overrides })).active).toBe(
      false,
    );
  });
});

describe('consumptionStatus', () => {
  const base = { hasRun: true, streaming: false, live: false, paused: false, done: false };

  it('names every state explicitly', () => {
    expect(consumptionStatus({ ...base, hasRun: false }).label).toBe('Idle');
    expect(consumptionStatus({ ...base, streaming: true, live: true }).label).toBe('Live');
    expect(consumptionStatus({ ...base, streaming: true, live: true, paused: true }).label).toBe(
      'Paused',
    );
    expect(consumptionStatus({ ...base, streaming: true }).label).toBe('Fetching');
    expect(consumptionStatus({ ...base, done: true }).label).toBe('Stopped');
    expect(consumptionStatus(base).id).toBe('stopped');
  });
});

describe('buildMessagesQuery', () => {
  it('emits only the fields the current mode uses', () => {
    const q = buildMessagesQuery(config({ mode: 'latest', filter: '' }), [0, 1]);
    expect(q).toMatchObject({ mode: 'latest', limit: 100 });
    expect(q.offset).toBeUndefined();
    expect(q.filter).toBeUndefined();
    expect(q.filterMode).toBeUndefined();
    expect(q.partitions).toBeUndefined();
  });

  it('carries per-partition offset overrides that differ from the scalar offset', () => {
    const q = buildMessagesQuery(
      config({
        mode: 'offset',
        offset: '100',
        partitions: ['0', '1'],
        perPartitionOffsets: { '0': '250', '1': '100', '2': '9' },
      }),
      [0, 1],
    );
    expect(q.offset).toBe(100);
    expect(q.startOffsets).toEqual([{ partition: 0, offset: 250 }]);
    expect(q.partitions).toEqual([0, 1]);
  });

  it('drops filterTarget=any and keeps the mode when a filter is set', () => {
    const q = buildMessagesQuery(config({ filter: 'abc', filterMode: 'regex' }), []);
    expect(q.filter).toBe('abc');
    expect(q.filterMode).toBe('regex');
    expect(q.filterTarget).toBeUndefined();
  });
});

describe('sanitizeQueryConfig', () => {
  it('keeps only known configuration keys — never message payloads', () => {
    const clean = sanitizeQueryConfig({
      ...DEFAULT_QUERY_CONFIG,
      messages: [{ key: 'k', value: 'secret payload' }],
      results: 'nope',
      filter: 'orderId=1',
    });
    expect(clean).not.toHaveProperty('messages');
    expect(clean).not.toHaveProperty('results');
    expect(Object.keys(clean).sort()).toEqual(Object.keys(DEFAULT_QUERY_CONFIG).sort());
    expect(clean.filter).toBe('orderId=1');
  });

  it('falls back to defaults for invalid enum and scalar values', () => {
    const clean = sanitizeQueryConfig({
      mode: 'wormhole',
      keyFormat: 'yaml',
      valueFormat: 42,
      filterMode: 'fuzzy',
      filterTarget: 'body',
      limit: 'lots',
      offset: 'abc',
      partitions: ['0', 'x', 3, null],
      perPartitionOffsets: { '0': '5', bad: '1', '1': 'x' },
      fieldColumns: ['a.b', '', 'a..b', 'a.b'],
      hideTombstones: 'yes',
      timestamp: 'now',
    });
    expect(clean.mode).toBe('latest');
    expect(clean.keyFormat).toBe('auto');
    expect(clean.valueFormat).toBe('auto');
    expect(clean.filterMode).toBe('contains');
    expect(clean.filterTarget).toBe('any');
    expect(clean.limit).toBe(100);
    expect(clean.offset).toBe('0');
    expect(clean.partitions).toEqual(['0', '3']);
    expect(clean.perPartitionOffsets).toEqual({ '0': '5' });
    expect(clean.fieldColumns).toEqual(['a.b']);
    expect(clean.hideTombstones).toBe(false);
    expect(clean.timestamp).toBeNull();
  });

  it('treats non-objects as an empty config', () => {
    expect(sanitizeQueryConfig(null)).toEqual(DEFAULT_QUERY_CONFIG);
    expect(sanitizeQueryConfig('garbage')).toEqual(DEFAULT_QUERY_CONFIG);
  });
});

describe('saved search serialization', () => {
  const saved = createSavedSearch('Failed orders', {
    ...DEFAULT_QUERY_CONFIG,
    mode: 'timestamp',
    timestamp: 1_700_000_000_000,
    partitions: ['2'],
    limit: 500,
    keyFormat: 'string',
    valueFormat: 'json',
    filter: '$.order.status',
    filterMode: 'jsonpath',
    filterTarget: 'value',
    hideTombstones: true,
    fieldColumns: ['order.status', 'order.items[0].sku'],
  });

  it('round-trips a saved search unchanged', () => {
    const [restored] = parseSavedSearches(serializeSavedSearches([saved]));
    expect(restored).toEqual(saved);
    expect(restored.config).toEqual(saved.config);
  });

  it('never persists message payloads that sneak into the config', () => {
    const text = serializeSavedSearches([
      { ...saved, config: { ...saved.config, messages: ['payload'] } as MessageQueryConfig },
    ]);
    expect(text).not.toContain('payload');
    expect(parseSavedSearches(text)[0].config).toEqual(saved.config);
  });

  it('tolerates corrupt storage payloads', () => {
    expect(parseSavedSearches(null)).toEqual([]);
    expect(parseSavedSearches('')).toEqual([]);
    expect(parseSavedSearches('{not json')).toEqual([]);
    expect(parseSavedSearches('"a string"')).toEqual([]);
    expect(parseSavedSearches('{"items":"nope"}')).toEqual([]);
    expect(parseSavedSearches('{"items":[null,3,{"name":""}]}')).toEqual([]);
  });

  it('repairs entries with a missing or partial config', () => {
    const list = parseSavedSearches('{"items":[{"name":"Keys only"}]}');
    expect(list).toHaveLength(1);
    expect(list[0].config).toEqual(DEFAULT_QUERY_CONFIG);
    expect(list[0].id).not.toBe('');
    expect(list[0].savedAt).toBe(0);
  });

  it('accepts a bare array of entries', () => {
    const list = parseSavedSearches(JSON.stringify([{ name: 'Legacy', config: { mode: 'tail' } }]));
    expect(list).toHaveLength(1);
    expect(list[0].config.mode).toBe('tail');
  });

  it('scopes the storage key per cluster and topic', () => {
    expect(savedSearchesKey('local', 'orders')).not.toBe(savedSearchesKey('prod', 'orders'));
    expect(savedSearchesKey('local', 'a/b')).toContain('a%2Fb');
  });
});
