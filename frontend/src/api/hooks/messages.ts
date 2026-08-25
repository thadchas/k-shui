import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, sse } from '@/api/client';
import { downloadBlob } from '@/lib/utils';
import type {
  ExportFormat,
  Message,
  MessageProgress,
  MessagesQuery,
  MessagesResponse,
  ProduceMessageRequest,
  ProduceMessageResponse,
} from '@/api/types';

function messagesPath(cluster: string, topic: string) {
  return `/clusters/${cluster}/topics/${encodeURIComponent(topic)}/messages`;
}

function queryParams(query: MessagesQuery) {
  return {
    mode: query.mode,
    partitions: Array.isArray(query.partitions) ? query.partitions : query.partitions,
    offset: query.offset,
    startOffsets:
      query.startOffsets && query.startOffsets.length > 0
        ? query.startOffsets.map((s) => `${s.partition}:${s.offset}`).join(',')
        : undefined,
    timestamp: query.timestamp,
    limit: query.limit,
    keyFormat: query.keyFormat,
    valueFormat: query.valueFormat,
    filter: query.filter,
    filterMode: query.filterMode,
    filterTarget: query.filterTarget,
  };
}

export interface MessageStreamState {
  messages: Message[];
  progress: MessageProgress;
  streaming: boolean;
  /** `mode=tail`: the connection follows the topic until `stop()`. */
  live: boolean;
  /** Tail only: rendering is frozen; new records are buffered (bounded by `limit`). */
  paused: boolean;
  /** Tail only: records buffered while paused, waiting for `resume()`. */
  pendingCount: number;
  /** Tail only: records the server still has to deliver (from the last heartbeat). */
  behind: number;
  /** Bumped every time new rows are rendered, so the UI can react (e.g. auto-scroll). */
  lastFlushAt: number;
  error: Error | null;
  start: (query: MessagesQuery) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  clear: () => void;
}

const EMPTY_PROGRESS: MessageProgress = { scanned: 0, matched: 0, done: false };

/**
 * Live message browsing over SSE. Buffers incoming messages and flushes on an
 * animation frame so a fast topic cannot thrash React.
 *
 * Bounded modes (latest/earliest/offset/timestamp) append in arrival order and end when
 * the server sends `end`. Tail mode prepends (newest first), keeps a ring buffer of
 * `limit` rows, never finishes on its own, and can be paused without dropping the
 * connection: records keep arriving into the buffer and are flushed on `resume()`.
 */
export function useMessageStream(cluster: string, topic: string): MessageStreamState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [progress, setProgress] = useState<MessageProgress>(EMPTY_PROGRESS);
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [behind, setBehind] = useState(0);
  const [lastFlushAt, setLastFlushAt] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef<Message[]>([]);
  const frameRef = useRef<number | null>(null);
  const limitRef = useRef<number>(500);
  const liveRef = useRef(false);
  const pausedRef = useRef(false);

  const flush = useCallback(() => {
    frameRef.current = null;
    if (pausedRef.current) {
      // frozen: only surface how much is waiting
      setPendingCount(bufferRef.current.length);
      return;
    }
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    const limit = limitRef.current;
    setMessages((prev) => {
      if (liveRef.current) {
        // newest first; drop the oldest rows beyond the ring buffer
        const next = batch.slice().reverse().concat(prev);
        return next.length > limit ? next.slice(0, limit) : next;
      }
      const next = prev.concat(batch);
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
    setPendingCount(0);
    setLastFlushAt(Date.now());
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    flush();
    setStreaming(false);
  }, [flush]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    flush();
  }, [flush]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    setMessages([]);
    setProgress(EMPTY_PROGRESS);
    setPendingCount(0);
    setBehind(0);
    setError(null);
  }, []);

  const start = useCallback(
    (query: MessagesQuery) => {
      abortRef.current?.();
      bufferRef.current = [];
      limitRef.current = Math.max(query.limit ?? 100, 1);
      liveRef.current = query.mode === 'tail';
      pausedRef.current = false;
      setLive(liveRef.current);
      setPaused(false);
      setPendingCount(0);
      setBehind(0);
      setMessages([]);
      setProgress(EMPTY_PROGRESS);
      setError(null);
      setStreaming(true);

      abortRef.current = sse(messagesPath(cluster, topic), {
        params: { ...queryParams(query), stream: true },
        on: {
          message: (payload) => {
            const buffer = bufferRef.current;
            buffer.push(payload as Message);
            // while paused the buffer is the ring: keep only the newest `limit`
            if (buffer.length > limitRef.current)
              buffer.splice(0, buffer.length - limitRef.current);
            schedule();
          },
          progress: (payload) => {
            const p = payload as MessageProgress;
            setProgress(p);
            if (typeof p.behind === 'number') setBehind(p.behind);
          },
          error: (payload) => {
            const detail =
              payload && typeof payload === 'object' && 'detail' in payload
                ? String((payload as { detail: unknown }).detail)
                : payload && typeof payload === 'object' && 'error' in payload
                  ? String((payload as { error: unknown }).error)
                  : String(payload);
            setError(new Error(detail));
          },
          end: () => {
            pausedRef.current = false;
            setPaused(false);
            flush();
            setProgress((p) => ({ ...p, done: true }));
            setStreaming(false);
          },
        },
        onError: (e) => {
          setError(e instanceof Error ? e : new Error(String(e)));
          setStreaming(false);
        },
        onClose: () => {
          pausedRef.current = false;
          setPaused(false);
          flush();
          setStreaming(false);
        },
      });
    },
    [cluster, topic, flush, schedule],
  );

  useEffect(
    () => () => {
      abortRef.current?.();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return {
    messages,
    progress,
    streaming,
    live,
    paused,
    pendingCount,
    behind,
    lastFlushAt,
    error,
    start,
    stop,
    pause,
    resume,
    clear,
  };
}

/** Non-streaming fetch (used for exports/preview). */
export function fetchMessages(cluster: string, topic: string, query: MessagesQuery) {
  return api.get<MessagesResponse>(messagesPath(cluster, topic), {
    ...queryParams(query),
    stream: false,
  });
}

export function useProduceMessage(cluster: string, topic: string) {
  return useMutation({
    mutationFn: (body: ProduceMessageRequest) =>
      api.post<ProduceMessageResponse>(messagesPath(cluster, topic), body),
  });
}

export function useExportMessages(cluster: string, topic: string) {
  return useMutation({
    mutationFn: async ({ format, query }: { format: ExportFormat; query: MessagesQuery }) => {
      const { blob, filename } = await api.download(`${messagesPath(cluster, topic)}/export`, {
        ...queryParams(query),
        format,
      });
      downloadBlob(blob, filename ?? `${topic}-messages.${format}`);
    },
  });
}
