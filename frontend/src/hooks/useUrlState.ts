import { useCallback, useMemo } from 'react';
import { useSearchParams, type NavigateOptions } from 'react-router';

/**
 * Per-key codec. `parse` receives the raw string (never null); `serialize` must return the
 * string form. Keys whose value equals the default are removed from the URL.
 */
export interface UrlCodec<T> {
  parse: (raw: string) => T;
  serialize: (value: T) => string;
}

export type UrlCodecs<T extends Record<string, unknown>> = { [K in keyof T]?: UrlCodec<T[K]> };

export interface UseUrlStateOptions<T extends Record<string, unknown>> {
  codecs?: UrlCodecs<T>;
  /** `replace` (default) keeps typing out of history; set `false` to push. */
  replace?: boolean;
}

export type UrlStateUpdate<T> = Partial<T> | ((prev: T) => Partial<T>);

const identity: UrlCodec<string> = { parse: (r) => r, serialize: (v) => v };

/** Codec for numeric params — falls back to `fallback` on NaN. */
export const numberCodec = (fallback: number): UrlCodec<number> => ({
  parse: (r) => {
    const n = Number(r);
    return Number.isFinite(n) ? n : fallback;
  },
  serialize: (v) => String(v),
});

export const booleanCodec: UrlCodec<boolean> = {
  parse: (r) => r === '1' || r === 'true',
  serialize: (v) => (v ? '1' : '0'),
};

/** Codec for a fixed set of string values; unknown values fall back to `fallback`. */
export const enumCodec = <V extends string>(values: readonly V[], fallback: V): UrlCodec<V> => ({
  parse: (r) => ((values as readonly string[]).includes(r) ? (r as V) : fallback),
  serialize: (v) => v,
});

/** Comma-separated string list. */
export const listCodec: UrlCodec<string[]> = {
  parse: (r) => r.split(',').filter(Boolean),
  serialize: (v) => v.join(','),
};

function codecFor<T extends Record<string, unknown>, K extends keyof T>(
  codecs: UrlCodecs<T> | undefined,
  key: K,
  defaultValue: T[K],
): UrlCodec<T[K]> {
  const explicit = codecs?.[key];
  if (explicit) return explicit;
  let inferred: UrlCodec<unknown>;
  if (typeof defaultValue === 'number') inferred = numberCodec(defaultValue) as UrlCodec<unknown>;
  else if (typeof defaultValue === 'boolean') inferred = booleanCodec as UrlCodec<unknown>;
  else if (Array.isArray(defaultValue)) inferred = listCodec as UrlCodec<unknown>;
  else inferred = identity as UrlCodec<unknown>;
  return inferred as UrlCodec<T[K]>;
}

/**
 * Sync a small object of page state (search / sort / page / perPage / tab / filters) with the
 * URL query string. Keys equal to their default are dropped from the URL; unknown params are
 * preserved (copy-and-set), so multiple hooks / components may share the same URL.
 *
 * ```ts
 * const [state, setState] = useUrlState({ q: '', page: 1, perPage: 50, tab: 'acls' });
 * setState({ q: 'foo', page: 1 });            // replace-navigates to ?q=foo
 * setState((prev) => ({ page: prev.page + 1 }));
 * ```
 * Codecs are inferred from the default's type (string / number / boolean / string[]); pass
 * `codecs` for enums or custom shapes.
 */
export function useUrlState<T extends Record<string, unknown>>(
  defaults: T,
  options: UseUrlStateOptions<T> = {},
): [T, (update: UrlStateUpdate<T>, navOpts?: NavigateOptions) => void] {
  const { codecs, replace = true } = options;
  const [params, setParams] = useSearchParams();

  const state = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = params.get(String(key));
      if (raw === null) continue;
      out[key] = codecFor(codecs, key, defaults[key]).parse(raw);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, JSON.stringify(defaults), codecs]);

  const setState = useCallback(
    (update: UrlStateUpdate<T>, navOpts?: NavigateOptions) => {
      setParams(
        (prev) => {
          const current = { ...defaults };
          for (const key of Object.keys(defaults) as (keyof T)[]) {
            const raw = prev.get(String(key));
            if (raw !== null) current[key] = codecFor(codecs, key, defaults[key]).parse(raw);
          }
          const patch = typeof update === 'function' ? update(current) : update;
          const next = new URLSearchParams(prev);
          for (const key of Object.keys(patch) as (keyof T)[]) {
            const value = patch[key] as T[keyof T];
            const codec = codecFor(codecs, key, defaults[key]);
            const isDefault =
              value === undefined ||
              value === null ||
              codec.serialize(value) === codec.serialize(defaults[key]);
            if (isDefault) next.delete(String(key));
            else next.set(String(key), codec.serialize(value));
          }
          return next;
        },
        { replace, ...navOpts },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams, JSON.stringify(defaults), codecs, replace],
  );

  return [state, setState];
}

/**
 * Single-key convenience: `const [tab, setTab] = useSearchParamState('tab', 'history')`.
 */
export function useSearchParamState<V extends string | number | boolean>(
  key: string,
  defaultValue: V,
  codec?: UrlCodec<V>,
): [V, (value: V, navOpts?: NavigateOptions) => void] {
  const codecs = useMemo(
    () => (codec ? ({ [key]: codec } as UrlCodecs<Record<string, V>>) : undefined),
    [key, codec],
  );
  const defaults = useMemo(() => ({ [key]: defaultValue }), [key, defaultValue]);
  const [state, setState] = useUrlState<Record<string, V>>(defaults, { codecs });
  const set = useCallback(
    (value: V, navOpts?: NavigateOptions) => setState({ [key]: value }, navOpts),
    [setState, key],
  );
  return [state[key], set];
}
