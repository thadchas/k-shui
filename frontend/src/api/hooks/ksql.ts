/** ksqlDB hooks — pages land with the Streaming agent. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, sse } from '@/api/client';
import { qk } from '@/api/keys';
import type {
  KsqlCloseQueryResponse,
  KsqlCluster,
  KsqlHeaderEvent,
  KsqlHistoryEntry,
  KsqlQueryInfo,
  KsqlQueryRequest,
  KsqlRowEvent,
  KsqlSourceDescription,
  KsqlStream,
  KsqlTable,
} from '@/api/types';

export function useKsqlClusters(cluster: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.ksqlClusters(cluster ?? ''),
    queryFn: () => api.get<KsqlCluster[]>(`/clusters/${cluster}/ksql`),
    enabled: Boolean(cluster) && enabled,
    retry: false,
  });
}

export function useKsqlStreams(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlStreams(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlStream[]>(`/clusters/${cluster}/ksql/${k}/streams`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlTables(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlTables(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlTable[]>(`/clusters/${cluster}/ksql/${k}/tables`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlQueries(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlQueries(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlQueryInfo[]>(`/clusters/${cluster}/ksql/${k}/queries`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlHistory(cluster: string | undefined, k: string | undefined) {
  return useQuery({
    queryKey: qk.ksqlHistory(cluster ?? '', k ?? ''),
    queryFn: () => api.get<KsqlHistoryEntry[]>(`/clusters/${cluster}/ksql/${k}/history`),
    enabled: Boolean(cluster && k),
    retry: false,
  });
}

export function useKsqlStatement(cluster: string, k: string) {
  return useMutation({
    mutationFn: (body: KsqlQueryRequest) =>
      api.post<unknown[]>(`/clusters/${cluster}/ksql/${k}/statement`, body),
  });
}

export function useTerminateKsqlQuery(cluster: string, k: string) {
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/clusters/${cluster}/ksql/${k}/queries/${encodeURIComponent(id)}`),
  });
}

/** Close a transient push query by id (`POST .../close-query`). */
export function useCloseKsqlQuery(cluster: string, k: string) {
  return useMutation({
    mutationFn: (queryId: string) =>
      api.post<KsqlCloseQueryResponse>(`/clusters/${cluster}/ksql/${k}/close-query`, { queryId }),
  });
}

/* -------------------------------------------------------------------------- *
 * Additions for the ksqlDB page: DESCRIBE EXTENDED + push-query SSE streaming.
 * -------------------------------------------------------------------------- */

export type KsqlSourceKind = 'stream' | 'table';

export function useKsqlDescribe(
  cluster: string | undefined,
  k: string | undefined,
  kind: KsqlSourceKind | undefined,
  name: string | undefined,
) {
  return useQuery({
    queryKey: [
      ...qk.ksqlStreams(cluster ?? '', k ?? ''),
      'describe',
      kind ?? '',
      name ?? '',
    ] as const,
    queryFn: () =>
      api.get<KsqlSourceDescription>(
        `/clusters/${cluster}/ksql/${k}/${kind === 'table' ? 'tables' : 'streams'}/${encodeURIComponent(name!)}`,
      ),
    enabled: Boolean(cluster && k && kind && name),
    retry: false,
  });
}

export interface KsqlStreamState {
  columns: string[];
  columnTypes: string[];
  queryId: string | null;
  rows: unknown[][];
  /** Total rows received from the server, including any evicted from the ring buffer. */
  received: number;
  /** Ring-buffer cap the current run was started with. */
  maxRows: number;
  streaming: boolean;
  error: Error | null;
  finished: boolean;
  start: (request: KsqlQueryRequest, maxRows?: number) => void;
  stop: () => void;
  clear: () => void;
}

export const KSQL_ROW_LIMITS = [500, 2000, 10000] as const;
const MAX_ROWS_DEFAULT = 2000;

/**
 * Push/pull query streaming over SSE. Rows are buffered and flushed on an
 * animation frame so a fast query cannot thrash React.
 */
export function useKsqlQueryStream(
  cluster: string | undefined,
  k: string | undefined,
): KsqlStreamState {
  const [columns, setColumns] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<string[]>([]);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [received, setReceived] = useState(0);
  const [maxRows, setMaxRows] = useState(MAX_ROWS_DEFAULT);
  const [streaming, setStreaming] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<(() => void) | null>(null);
  const bufferRef = useRef<unknown[][]>([]);
  const frameRef = useRef<number | null>(null);
  const maxRowsRef = useRef<number>(MAX_ROWS_DEFAULT);

  const flush = useCallback(() => {
    frameRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setReceived((n) => n + batch.length);
    setRows((prev) => {
      const next = prev.concat(batch);
      return next.length > maxRowsRef.current ? next.slice(next.length - maxRowsRef.current) : next;
    });
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    flush();
    setStreaming(false);
  }, [flush]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    setRows([]);
    setReceived(0);
    setColumns([]);
    setColumnTypes([]);
    setQueryId(null);
    setError(null);
    setFinished(false);
  }, []);

  const start = useCallback(
    (request: KsqlQueryRequest, limit = MAX_ROWS_DEFAULT) => {
      if (!cluster || !k) return;
      abortRef.current?.();
      bufferRef.current = [];
      maxRowsRef.current = Math.max(limit, 1);
      setMaxRows(maxRowsRef.current);
      setRows([]);
      setReceived(0);
      setColumns([]);
      setColumnTypes([]);
      setQueryId(null);
      setError(null);
      setFinished(false);
      setStreaming(true);

      abortRef.current = sse(`/clusters/${cluster}/ksql/${k}/query`, {
        method: 'POST',
        body: request,
        on: {
          header: (payload) => {
            const header = payload as KsqlHeaderEvent;
            setColumns(header.columnNames ?? []);
            setColumnTypes(header.columnTypes ?? []);
            setQueryId(header.queryId ?? null);
          },
          row: (payload) => {
            const row = payload as KsqlRowEvent;
            bufferRef.current.push(Array.isArray(row?.values) ? row.values : [row]);
            schedule();
          },
          error: (payload) => {
            const detail =
              payload && typeof payload === 'object' && 'detail' in payload
                ? String((payload as { detail: unknown }).detail)
                : typeof payload === 'object' && payload && 'message' in payload
                  ? String((payload as { message: unknown }).message)
                  : String(payload);
            setError(new Error(detail));
            flush();
            setFinished(true);
            setStreaming(false);
          },
          end: () => {
            flush();
            setFinished(true);
            setStreaming(false);
          },
        },
        onError: (e) => {
          flush();
          setError(e instanceof Error ? e : new Error(String(e)));
          setFinished(true);
          setStreaming(false);
        },
        onClose: () => {
          flush();
          setStreaming(false);
        },
      });
    },
    [cluster, k, flush, schedule],
  );

  useEffect(
    () => () => {
      abortRef.current?.();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return {
    columns,
    columnTypes,
    queryId,
    rows,
    received,
    maxRows,
    streaming,
    finished,
    error,
    start,
    stop,
    clear,
  };
}
