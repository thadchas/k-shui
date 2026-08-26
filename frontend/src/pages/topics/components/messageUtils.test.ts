import { describe, expect, it } from 'vitest';
import type { Message } from '@/api/types';
import {
  exactKeyPattern,
  formatMessageTimestamp,
  isTombstone,
  serializeMessages,
  stringifyField,
} from './messageUtils';

const msg = (over: Partial<Message>): Message =>
  ({
    partition: 0,
    offset: 1,
    timestamp: 1_700_000_000_000,
    timestampType: 'CreateTime',
    key: 'k',
    keyFormat: 'string',
    value: 'v',
    valueFormat: 'string',
    headers: {},
    keySchemaId: null,
    valueSchemaId: null,
    sizeBytes: 2,
    ...over,
  }) as Message;

describe('isTombstone', () => {
  it('is true only for keyed records with a null value', () => {
    expect(isTombstone({ key: 'k', value: null })).toBe(true);
    expect(isTombstone({ key: null, value: null })).toBe(false);
    expect(isTombstone({ key: 'k', value: '' })).toBe(false);
    expect(isTombstone({ key: { id: 1 }, value: null })).toBe(true);
  });
});

describe('formatMessageTimestamp', () => {
  it('renders epoch and UTC forms and dashes for missing', () => {
    expect(formatMessageTimestamp(null, 'utc')).toBe('—');
    expect(formatMessageTimestamp(1_700_000_000_000, 'epoch')).toBe('1700000000000');
    expect(formatMessageTimestamp(1_700_000_000_000, 'utc')).toBe('2023-11-14 22:13:20Z');
  });
});

describe('exactKeyPattern', () => {
  it('escapes regex metacharacters and anchors', () => {
    const p = exactKeyPattern('user.1+2(x)');
    expect(new RegExp(p).test('user.1+2(x)')).toBe(true);
    expect(new RegExp(p).test('userX1+2(x)')).toBe(false);
    expect(p.startsWith('^') && p.endsWith('$')).toBe(true);
  });
});

describe('serializeMessages', () => {
  const data = [
    msg({ key: 'a,b', value: { n: 1 }, headers: { h: 'x' } }),
    msg({ offset: 2, key: null, value: 'say "hi"\nnow', keyRaw: 'RAW' } as Partial<Message>),
  ];
  it('csv quotes commas, quotes and newlines', async () => {
    const { blob, extension } = serializeMessages(data, 'csv');
    expect(extension).toBe('csv');
    const text = await blob.text();
    const lines = text.split('\n');
    expect(lines[0]).toBe('partition,offset,timestamp,key,value,headers');
    expect(lines[1]).toContain('"a,b"');
    expect(lines[1]).toContain('"{""n"":1}"');
    expect(text).toContain('"say ""hi""\nnow"');
  });
  it('ndjson emits one JSON object per line without raw fields', async () => {
    const text = await serializeMessages(data, 'ndjson').blob.text();
    const rows = text.split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(rows[1]).not.toHaveProperty('keyRaw');
  });
  it('json wraps items with a scanned count', async () => {
    const parsed = JSON.parse(await serializeMessages(data, 'json').blob.text());
    expect(parsed.scanned).toBe(2);
    expect(parsed.items[0].headers).toEqual({ h: 'x' });
  });
  it('stringifyField handles primitives and objects', () => {
    expect(stringifyField(null)).toBe('');
    expect(stringifyField('s')).toBe('s');
    expect(stringifyField({ a: 1 })).toBe('{"a":1}');
  });
});
