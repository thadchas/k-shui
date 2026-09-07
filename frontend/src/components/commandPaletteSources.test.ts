import { describe, expect, it } from 'vitest';
import {
  applyKindFilter,
  buildSourceGroups,
  deriveSourceStatus,
  errorDetail,
  flattenSettled,
  isGroupVisible,
  matchesTerm,
  parsePaletteQuery,
  PREFIX_HELP,
  RESOURCE_TYPES,
  summarizePaletteSources,
  toAlertResults,
  toConnectorResults,
  toFlinkJobResults,
  toGroupResults,
  toSchemaResults,
  toTopicResults,
  type PaletteResult,
  type PaletteSourceInput,
  type ResourceKind,
} from './commandPaletteSources';

/* ------------------------------- fixtures --------------------------------- */

const result = (kind: ResourceKind, name: string): PaletteResult => ({
  kind,
  id: `${kind}:${name}`,
  title: name,
  href: `/${kind}/${name}`,
});

function source(
  kind: ResourceKind,
  overrides: Partial<PaletteSourceInput> = {},
): PaletteSourceInput {
  return {
    kind,
    enabled: true,
    isLoading: false,
    isError: false,
    results: [],
    ...overrides,
  };
}

/* ----------------------------- prefix parsing ----------------------------- */

describe('parsePaletteQuery', () => {
  it('returns the raw term when no prefix is used', () => {
    expect(parsePaletteQuery('  orders  ')).toEqual({
      kind: null,
      prefix: null,
      term: 'orders',
      searchable: true,
    });
  });

  it.each([
    ['t: orders', 'topic', 'orders'],
    ['t:orders', 'topic', 'orders'],
    ['cg: billing', 'group', 'billing'],
    ['c: sink', 'connector', 'sink'],
    ['j: job', 'flinkJob', 'job'],
    ['s: subject', 'schema', 'subject'],
    ['a: alert', 'alert', 'alert'],
  ])('parses %s as a %s search', (raw, kind, term) => {
    const parsed = parsePaletteQuery(raw);
    expect(parsed.kind).toBe(kind);
    expect(parsed.term).toBe(term);
  });

  it('accepts long-form and mixed-case prefixes', () => {
    expect(parsePaletteQuery('Topics: orders').kind).toBe('topic');
    expect(parsePaletteQuery('CONNECTORS: s3').kind).toBe('connector');
    expect(parsePaletteQuery('subject : user-value').kind).toBe('schema');
  });

  it('keeps an unknown prefix as part of the literal term', () => {
    expect(parsePaletteQuery('foo: bar')).toEqual({
      kind: null,
      prefix: null,
      term: 'foo: bar',
      searchable: true,
    });
  });

  it('requires two characters unfiltered but only one when a type is pinned', () => {
    expect(parsePaletteQuery('o').searchable).toBe(false);
    expect(parsePaletteQuery('or').searchable).toBe(true);
    expect(parsePaletteQuery('t: o').searchable).toBe(true);
    expect(parsePaletteQuery('t:').searchable).toBe(false);
  });

  it('documents every resource type in the help line', () => {
    expect(PREFIX_HELP).toHaveLength(RESOURCE_TYPES.length);
    expect(PREFIX_HELP[0]).toBe('t: topics');
  });
});

describe('applyKindFilter', () => {
  it('adds, swaps and clears the prefix while keeping the term', () => {
    expect(applyKindFilter('orders', 'topic')).toBe('t: orders');
    expect(applyKindFilter('t: orders', 'schema')).toBe('s: orders');
    expect(applyKindFilter('t: orders', null)).toBe('orders');
    expect(applyKindFilter('', 'connector')).toBe('c: ');
  });
});

describe('matchesTerm', () => {
  it('matches case-insensitively over any field and accepts everything when empty', () => {
    expect(matchesTerm('SINK', 'my-s3-sink', null)).toBe(true);
    expect(matchesTerm('s3', undefined, 'io.confluent.S3SinkConnector')).toBe(true);
    expect(matchesTerm('nope', 'my-s3-sink')).toBe(false);
    expect(matchesTerm('  ', 'anything')).toBe(true);
  });
});

/* --------------------------- routes for results --------------------------- */

describe('result mapping', () => {
  it('routes every resource type to its exact detail page with encoded segments', () => {
    expect(
      toTopicResults(
        [{ name: 'orders/v1', partitions: 3, replicationFactor: 2 } as never],
        'prod',
      )[0].href,
    ).toBe('/c/prod/topics/orders%2Fv1');

    expect(toGroupResults([{ groupId: 'billing app', totalLag: 4 } as never], 'prod')[0].href).toBe(
      '/c/prod/consumers/billing%20app',
    );

    expect(
      toConnectorResults(
        [{ kc: 'kc one', connector: { name: 's3 sink', state: 'RUNNING' } as never }],
        'prod',
      )[0].href,
    ).toBe('/c/prod/connect/kc%20one/connectors/s3%20sink');

    expect(
      toFlinkJobResults(
        [{ fc: 'fc1', job: { jid: 'abc123', name: 'enrich', state: 'RUNNING' } as never }],
        'prod',
      )[0].href,
    ).toBe('/c/prod/flink/fc1/jobs/abc123');

    expect(
      toSchemaResults(
        [{ subject: 'orders-value', latestVersion: 3, schemaType: 'AVRO' } as never],
        'prod',
      )[0].href,
    ).toBe('/c/prod/schemas/orders-value');

    // Alert triggers are global, not cluster-scoped.
    expect(
      toAlertResults([{ id: 'trg-1', name: 'Lag', severity: 'warn', enabled: true } as never])[0]
        .href,
    ).toBe('/alerts/triggers/trg-1');
  });

  it('falls back to the job id when a Flink job has no name', () => {
    const [hit] = toFlinkJobResults(
      [{ fc: 'fc1', job: { jid: 'abc', name: '', state: 'RUNNING' } as never }],
      'prod',
    );
    expect(hit.title).toBe('abc');
  });
});

/* ------------------------------ source status ----------------------------- */

describe('deriveSourceStatus', () => {
  it.each([
    [{ enabled: false, isLoading: false, isError: false }, 'idle'],
    [{ enabled: false, isLoading: false, isError: true }, 'idle'],
    [{ enabled: true, isLoading: true, isError: false }, 'loading'],
    [{ enabled: true, isLoading: false, isError: true }, 'unavailable'],
    [{ enabled: true, isLoading: true, isError: true }, 'unavailable'],
    [{ enabled: true, isLoading: false, isError: false }, 'ready'],
  ])('%o → %s', (input, expected) => {
    expect(deriveSourceStatus(input)).toBe(expected);
  });
});

describe('errorDetail', () => {
  it('reads Error messages and plain strings, and ignores anything else', () => {
    expect(errorDetail(new Error('Connect unreachable'))).toBe('Connect unreachable');
    expect(errorDetail('boom')).toBe('boom');
    expect(errorDetail(undefined)).toBeNull();
    expect(errorDetail({ status: 503 })).toBeNull();
  });
});

/* ------------------------- filtering by resource type --------------------- */

describe('buildSourceGroups', () => {
  const sources = [
    source('topic', { results: [result('topic', 'orders')] }),
    source('group', { results: [result('group', 'billing')] }),
    source('schema', { results: [result('schema', 'orders-value')] }),
  ];

  it('keeps every source when no type filter is active', () => {
    expect(buildSourceGroups(sources).map((g) => g.kind)).toEqual(['topic', 'group', 'schema']);
  });

  it('keeps only the pinned type when a prefix filter is active', () => {
    const groups = buildSourceGroups(sources, { kind: 'schema' });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('schema');
    expect(groups[0].results[0].title).toBe('orders-value');
  });

  it('limits results per source', () => {
    const many = source('topic', {
      results: Array.from({ length: 20 }, (_, i) => result('topic', `t${i}`)),
    });
    expect(buildSourceGroups([many], { limit: 3 })[0].results).toHaveLength(3);
  });

  it('never shows results for a source that is loading, idle or errored', () => {
    const stale = [result('topic', 'orders')];
    expect(
      buildSourceGroups([source('topic', { isLoading: true, results: stale })])[0].results,
    ).toHaveLength(0);
    expect(
      buildSourceGroups([source('topic', { enabled: false, results: stale })])[0].results,
    ).toHaveLength(0);
    expect(
      buildSourceGroups([source('topic', { isError: true, results: stale })])[0].results,
    ).toHaveLength(0);
  });

  it('labels an errored source with a retry row naming the backend', () => {
    const [group] = buildSourceGroups([
      source('connector', { isError: true, error: new Error('503 Service Unavailable') }),
    ]);
    expect(group.status).toBe('unavailable');
    expect(group.message).toBe('Connect unavailable — press to retry');
    expect(group.detail).toBe('503 Service Unavailable');
  });

  it('renders unavailable and non-empty groups only', () => {
    const groups = buildSourceGroups([
      source('topic', { results: [result('topic', 'orders')] }),
      source('group'), // ready, no matches → nothing to draw
      source('flinkJob', { isError: true }),
      source('schema', { enabled: false }),
    ]);
    expect(groups.filter(isGroupVisible).map((g) => g.kind)).toEqual(['topic', 'flinkJob']);
  });
});

/* -------------------- partial failure / empty vs unavailable -------------- */

describe('summarizePaletteSources', () => {
  const searched = { searched: true };

  it('is idle before the query is long enough to search', () => {
    const groups = buildSourceGroups([source('topic', { enabled: false })]);
    const summary = summarizePaletteSources(groups, { searched: false });
    expect(summary.state).toBe('idle');
    expect(summary.message).toBe('');
  });

  it('reports plain results when every source answered', () => {
    const groups = buildSourceGroups([
      source('topic', { results: [result('topic', 'orders')] }),
      source('group', { results: [result('group', 'billing')] }),
    ]);
    const summary = summarizePaletteSources(groups, searched);
    expect(summary.state).toBe('results');
    expect(summary.total).toBe(2);
    expect(summary.message).toBe('');
  });

  it('keeps working results usable and names the failed source (partial failure)', () => {
    const groups = buildSourceGroups([
      source('topic', { results: [result('topic', 'orders')] }),
      source('group', { results: [result('group', 'billing')] }),
      source('connector', { isError: true, error: new Error('boom') }),
      source('flinkJob', { isError: true }),
    ]);
    const summary = summarizePaletteSources(groups, searched);

    expect(summary.state).toBe('partial');
    expect(summary.total).toBe(2);
    expect(summary.unavailable.map((g) => g.kind)).toEqual(['connector', 'flinkJob']);
    expect(summary.message).toBe('Partial results — Connect, Flink could not be searched.');
    // The healthy sources are still rendered with their results.
    const visible = groups.filter(isGroupVisible);
    expect(visible.filter((g) => g.status === 'ready').flatMap((g) => g.results)).toHaveLength(2);
  });

  it('distinguishes "no matches" from "could not search"', () => {
    const allAnswered = buildSourceGroups([source('topic'), source('group')]);
    expect(summarizePaletteSources(allAnswered, searched)).toMatchObject({
      state: 'empty',
      total: 0,
      message: 'No matching resources.',
    });

    const oneDown = buildSourceGroups([source('topic'), source('schema', { isError: true })]);
    expect(summarizePaletteSources(oneDown, searched)).toMatchObject({
      state: 'unavailable',
      total: 0,
      message: 'No results to show — Schema Registry could not be searched.',
    });
  });

  it('says it is still searching while sources are in flight', () => {
    const groups = buildSourceGroups([
      source('topic', { isLoading: true }),
      source('group', { isLoading: true }),
    ]);
    const summary = summarizePaletteSources(groups, searched);
    expect(summary.state).toBe('searching');
    expect(summary.loading).toBe(true);
  });
});

/* ------------------------------- fan-out ---------------------------------- */

describe('flattenSettled', () => {
  it('returns an empty list for an empty fan-out', () => {
    expect(flattenSettled([])).toEqual([]);
  });

  it('keeps what the reachable branches returned', () => {
    const out = flattenSettled<string>([
      { status: 'fulfilled', value: ['a', 'b'] },
      { status: 'rejected', reason: new Error('kc2 down') },
      { status: 'fulfilled', value: ['c'] },
    ]);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('throws when every branch failed so the source reads as unavailable', () => {
    expect(() =>
      flattenSettled<string>([
        { status: 'rejected', reason: new Error('kc1 down') },
        { status: 'rejected', reason: 'kc2 down' },
      ]),
    ).toThrow('kc1 down');
  });

  it('wraps a non-Error rejection reason', () => {
    expect(() => flattenSettled<string>([{ status: 'rejected', reason: 503 }])).toThrow('503');
  });
});
