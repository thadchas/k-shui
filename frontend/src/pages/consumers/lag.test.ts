import { describe, expect, it } from 'vitest';
import { formatTimeLag, TIME_LAG_WARN_MS } from './lag';

describe('formatTimeLag', () => {
  it('never renders a missing estimate as caught up', () => {
    expect(formatTimeLag(null)).toBe('—');
    expect(formatTimeLag(undefined)).toBe('—');
    expect(formatTimeLag(Number.NaN)).toBe('—');
  });
  it('formats small and large values', () => {
    expect(formatTimeLag(0)).toBe('0s');
    expect(formatTimeLag(400)).toBe('<1s');
    expect(formatTimeLag(90_000)).toMatch(/1m/);
  });
  it('warn threshold is five minutes', () => {
    expect(TIME_LAG_WARN_MS).toBe(300_000);
  });
});
