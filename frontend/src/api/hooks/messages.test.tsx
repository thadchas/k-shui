import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SseOptions } from '@/api/client';

type Handlers = NonNullable<SseOptions['on']>;
interface Stream {
  on: Handlers;
  onClose: SseOptions['onClose'];
  onError: SseOptions['onError'];
  aborted: boolean;
}

const streams: Stream[] = [];
vi.mock('@/api/client', () => ({
  api: {},
  sse: (_path: string, options: SseOptions) => {
    const stream: Stream = {
      on: options.on ?? {},
      onClose: options.onClose,
      onError: options.onError,
      aborted: false,
    };
    streams.push(stream);
    return () => {
      stream.aborted = true;
    };
  },
}));
vi.mock('@/lib/utils', () => ({ downloadBlob: vi.fn() }));

import { useMessageStream } from './messages';

const msg = (offset: number) => ({ partition: 0, offset, key: null, value: `m${offset}` });

describe('useMessageStream generation guard', () => {
  beforeEach(() => {
    streams.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('ignores callbacks from a stream that was replaced by a newer start()', () => {
    const { result } = renderHook(() => useMessageStream('c', 't'));
    act(() => result.current.start({ mode: 'latest', limit: 10 }));
    const first = streams[0];
    act(() => first.on.message?.(msg(1)));
    expect(result.current.messages).toHaveLength(1);

    act(() => result.current.start({ mode: 'latest', limit: 10 }));
    expect(first.aborted).toBe(true);
    expect(result.current.streaming).toBe(true);
    expect(result.current.messages).toHaveLength(0);

    // the aborted stream's async onClose / late events arrive after the restart
    act(() => {
      first.on.message?.(msg(2));
      first.on.progress?.({ scanned: 99, matched: 99, done: true });
      first.on.error?.({ detail: 'stale' });
      first.onClose?.();
      first.onError?.(new Error('stale'));
      first.on.end?.(undefined);
    });
    expect(result.current.streaming).toBe(true);
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.progress.scanned).toBe(0);
    expect(result.current.error).toBeNull();

    // the live stream still works
    const second = streams[1];
    act(() => {
      second.on.message?.(msg(3));
      second.on.end?.(undefined);
    });
    expect(result.current.messages.map((m) => m.offset)).toEqual([3]);
    expect(result.current.streaming).toBe(false);
    expect(result.current.progress.done).toBe(true);
  });

  it('stop() invalidates the running stream so its onClose cannot resurrect state', () => {
    const { result } = renderHook(() => useMessageStream('c', 't'));
    act(() => result.current.start({ mode: 'tail', limit: 5 }));
    const stream = streams[0];
    act(() => result.current.stop());
    expect(stream.aborted).toBe(true);
    expect(result.current.streaming).toBe(false);
    act(() => result.current.start({ mode: 'tail', limit: 5 }));
    act(() => stream.onClose?.());
    expect(result.current.streaming).toBe(true);
  });
});
