import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import {
  booleanCodec,
  enumCodec,
  listCodec,
  numberCodec,
  useSearchParamState,
  useUrlState,
} from './useUrlState';

function wrapper(initial = '/topics') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useUrlState', () => {
  it('reads defaults when the URL is empty and parses typed params', () => {
    const { result } = renderHook(
      () => useUrlState({ q: '', page: 1, showInternal: false, tags: [] as string[] }),
      { wrapper: wrapper('/topics?page=3&showInternal=1&tags=a,b') },
    );
    expect(result.current[0]).toEqual({ q: '', page: 3, showInternal: true, tags: ['a', 'b'] });
  });

  it('drops default-valued keys from the URL and preserves unrelated params', () => {
    const { result } = renderHook(
      () => {
        const state = useUrlState({ q: '', page: 1 });
        const location = useLocation();
        return { state, search: location.search };
      },
      { wrapper: wrapper('/topics?tab=configs') },
    );
    act(() => result.current.state[1]({ q: 'orders', page: 2 }));
    expect(result.current.search).toContain('q=orders');
    expect(result.current.search).toContain('page=2');
    expect(result.current.search).toContain('tab=configs');
    act(() => result.current.state[1]({ page: 1 }));
    expect(result.current.search).not.toContain('page=');
    expect(result.current.search).toContain('q=orders');
  });

  it('supports the functional update form', () => {
    const { result } = renderHook(() => useUrlState({ page: 1 }), { wrapper: wrapper() });
    act(() => result.current[1]((prev) => ({ page: prev.page + 1 })));
    act(() => result.current[1]((prev) => ({ page: prev.page + 1 })));
    expect(result.current[0].page).toBe(3);
  });

  it('replaces history entries by default', () => {
    const { result } = renderHook(
      () => {
        const state = useUrlState({ q: '' });
        const location = useLocation();
        return { state, key: location.key, search: location.search };
      },
      { wrapper: wrapper() },
    );
    act(() => result.current.state[1]({ q: 'a' }));
    act(() => result.current.state[1]({ q: 'ab' }));
    expect(result.current.search).toBe('?q=ab');
  });

  it('useSearchParamState with enumCodec falls back on unknown values', () => {
    const { result } = renderHook(
      () => useSearchParamState('tab', 'editor', enumCodec(['editor', 'queries'], 'editor')),
      { wrapper: wrapper('/ksql?tab=bogus') },
    );
    expect(result.current[0]).toBe('editor');
    act(() => result.current[1]('queries'));
    expect(result.current[0]).toBe('queries');
  });
});

describe('codecs', () => {
  it('numberCodec falls back on NaN', () => {
    expect(numberCodec(7).parse('abc')).toBe(7);
    expect(numberCodec(7).parse('12')).toBe(12);
    expect(numberCodec(7).serialize(3)).toBe('3');
  });
  it('booleanCodec accepts 1/true', () => {
    expect(booleanCodec.parse('1')).toBe(true);
    expect(booleanCodec.parse('true')).toBe(true);
    expect(booleanCodec.parse('0')).toBe(false);
    expect(booleanCodec.serialize(true)).toBe('1');
  });
  it('listCodec round-trips and ignores empties', () => {
    expect(listCodec.parse('a,,b')).toEqual(['a', 'b']);
    expect(listCodec.serialize(['x', 'y'])).toBe('x,y');
  });
});
