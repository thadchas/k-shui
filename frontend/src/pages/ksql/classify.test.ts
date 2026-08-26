import { describe, expect, it } from 'vitest';
import { classifyKsqlQuery } from './KsqlPage';

describe('classifyKsqlQuery', () => {
  it('EMIT CHANGES is always push', () => {
    expect(classifyKsqlQuery('SELECT * FROM s WHERE id = 1 EMIT CHANGES;')).toBe('push');
  });
  it('a SELECT without WHERE is an unbounded scan (push)', () => {
    expect(classifyKsqlQuery('select * from t')).toBe('push');
  });
  it('a keyed lookup is pull', () => {
    expect(classifyKsqlQuery("SELECT * FROM t WHERE id = 'x';")).toBe('pull');
  });
  it('non-SELECT statements are not classified', () => {
    expect(classifyKsqlQuery('SHOW STREAMS;')).toBeNull();
    expect(classifyKsqlQuery('-- only a comment')).toBeNull();
  });
});
