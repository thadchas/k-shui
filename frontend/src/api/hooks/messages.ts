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
  };
}

export interface MessageStreamState {
  messages: Message[];
  progress: MessageProgress;
  streaming: boolean;
  error: Error | null;
  start: (query: MessagesQuery) => void;
  stop: () => void;
  clear: () => void;
}

const EMPTY_PROGRESS: MessageProgress = { scanned: 0, matched: 0, done: false };

/**
 * Live message browsing over SSE. Buffers incoming messages and flushes on an
 * animation frame so a fast topic cannot thrash React.
 */
export function useMessageStream(cluster: string, topic: string): MessageStreamState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [progress, setProgress] = useState<MessageProgress>(EMPTY_PROGRESS);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef<Message[]>([]);
  const frameRef = useRef<number | null>(null);
  const limitRef = useRef<number>(500);

  const flush = useCallback(() => {
    frameRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setMessages((prev) => {
      const next = prev.concat(batch);
      return next.length > limitRef.current ? next.slice(next.length - limitRef.current) : next;
    });
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = [];
    setMessages([]);
    setProgress(EMPTY_PROGRESS);
    setError(null);
  }, []);

  const start = useCallback(
    (query: MessagesQuery) => {
      abortRef.current?.();
      bufferRef.current = [];
      limitRef.current = Math.max(query.limit ?? 100, 1);
      setMessages([]);
      setProgress(EMPTY_PROGRESS);
      setError(null);
      setStreaming(true);

      abortRef.current = sse(messagesPath(cluster, topic), {
        params: { ...queryParams(query), stream: true },
        on: {
          message: (payload) => {
            bufferRef.current.push(payload as Message);
            schedule();
          },
          progress: (payload) => setProgress(payload as MessageProgress),
          error: (payload) => {
            const detail =
              payload && typeof payload === 'object' && 'detail' in payload
                ? String((payload as { detail: unknown }).detail)
                : String(payload);
            setError(new Error(detail));
          },
          end: () => {
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

  return { messages, progress, streaming, error, start, stop, clear };
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
