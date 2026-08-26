import { describe, expect, it } from 'vitest';
import { isReadOnlySql, ratioPct } from './flinkLib';

describe('isReadOnlySql', () => {
  it('accepts read-only statements, including comments and multiple statements', () => {
    expect(isReadOnlySql('SELECT 1')).toBe(true);
    expect(isReadOnlySql('-- comment\nSHOW TABLES; DESCRIBE t;')).toBe(true);
    expect(isReadOnlySql('/* x */ WITH a AS (SELECT 1) SELECT * FROM a')).toBe(true);
    expect(isReadOnlySql('')).toBe(true);
  });
  it('rejects DDL/DML anywhere in the script', () => {
    expect(isReadOnlySql('SELECT 1; INSERT INTO t SELECT 1')).toBe(false);
    expect(isReadOnlySql('CREATE TABLE t (a INT)')).toBe(false);
    expect(isReadOnlySql('DROP TABLE t')).toBe(false);
  });
});

describe('ratioPct', () => {
  it('guards against missing/zero denominators', () => {
    expect(ratioPct(undefined, 10)).toBeNull();
    expect(ratioPct(5, 0)).toBeNull();
    expect(ratioPct(5, 10)).toBe(50);
  });
});
