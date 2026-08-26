import { basePath } from '@/lib/utils';
import { getAuthToken, useAuthStore } from '@/stores/auth';
import type { ProblemDetail } from './types';

export const API_PREFIX = 'api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly problem: ProblemDetail | null;

  constructor(status: number, problem: ProblemDetail | null, fallback?: string) {
    const title = problem?.title ?? fallback ?? `Request failed (${status})`;
    const detail = problem?.detail ?? '';
    super(detail ? `${title}: ${detail}` : title);
    this.name = 'ApiError';
    this.status = status;
    this.type = problem?.type ?? 'about:blank';
    this.title = title;
    this.detail = detail;
    this.problem = problem;
  }

  /** Integration configured but unreachable / not configured at all. */
  get isIntegrationUnavailable(): boolean {
    return this.status === 503 || this.type.includes('integration-unavailable');
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export type QueryParams = Record<string, QueryValue>;

export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      sp.set(key, value.join(','));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Absolute URL for an API path like `/clusters/x/topics`. */
export function apiUrl(path: string, params?: QueryParams): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${basePath()}${API_PREFIX}/${clean}${buildQuery(params)}`;
}

/** Absolute URL for a non-versioned root path (`/healthz`, `/metrics`). */
export function rootUrl(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${basePath()}${clean}`;
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function toApiError(res: Response): Promise<ApiError> {
  let problem: ProblemDetail | null = null;
  try {
    const text = await res.text();
    if (text) {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        problem = {
          type: typeof p.type === 'string' ? p.type : undefined,
          title:
            typeof p.title === 'string'
              ? p.title
              : typeof p.detail === 'string'
                ? undefined
                : undefined,
          status: typeof p.status === 'number' ? p.status : res.status,
          detail:
            typeof p.detail === 'string'
              ? p.detail
              : typeof p.message === 'string'
                ? p.message
                : undefined,
        };
      }
    }
  } catch {
    /* body was not json */
  }
  return new ApiError(res.status, problem, res.statusText || undefined);
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: QueryParams;
  body?: unknown;
  /** Skip JSON parsing and return the raw Response. */
  raw?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { params, body, raw, headers, ...rest } = options;
  const isForm = body instanceof FormData;
  const res = await fetch(apiUrl(path, params), {
    method,
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(headers as Record<string, string> | undefined),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await toApiError(res);
    // Session missing/expired: drop the local session and flag it so AppShell can refetch
    // `/info` and send the user to /login (this module has no router access).
    if (err.status === 401) useAuthStore.getState().markSessionExpired();
    throw err;
  }

  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams, options?: RequestOptions) =>
    request<T>('GET', path, { ...options, params }),
  post: <T>(path: string, body?: unknown, params?: QueryParams, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body, params }),
  put: <T>(path: string, body?: unknown, params?: QueryParams, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body, params }),
  patch: <T>(path: string, body?: unknown, params?: QueryParams, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body, params }),
  delete: <T>(path: string, params?: QueryParams, options?: RequestOptions) =>
    request<T>('DELETE', path, { ...options, params }),
  /** Fetch a file (export endpoints) and return the Blob + suggested filename. */
  async download(
    path: string,
    params?: QueryParams,
  ): Promise<{ blob: Blob; filename: string | null }> {
    const res = await fetch(apiUrl(path, params), {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw await toApiError(res);
    const cd = res.headers.get('content-disposition');
    const match = cd?.match(/filename="?([^"]+)"?/);
    return { blob: await res.blob(), filename: match?.[1] ?? null };
  },
};

/* ------------------------------- SSE support ------------------------------ */

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export interface SseHandlers {
  /** Called for every parsed event. */
  onEvent?: (message: SseMessage) => void;
  /** Per-event-name handlers; receives the already JSON-parsed payload. */
  on?: Record<string, (payload: unknown) => void>;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

export interface SseOptions extends SseHandlers {
  method?: 'GET' | 'POST';
  params?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * SSE over `fetch` + ReadableStream so we can send auth headers and use POST.
 * Returns a function that aborts the stream.
 */
export function sse(path: string, options: SseOptions = {}): () => void {
  const { method = 'GET', params, body, signal, onEvent, on, onOpen, onError, onClose } = options;
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const dispatch = (message: SseMessage) => {
    onEvent?.(message);
    const handler = on?.[message.event];
    if (!handler) return;
    let payload: unknown = message.data;
    if (message.data) {
      try {
        payload = JSON.parse(message.data);
      } catch {
        payload = message.data;
      }
    }
    handler(payload);
  };

  void (async () => {
    try {
      const res = await fetch(apiUrl(path, params), {
        method,
        headers: {
          Accept: 'text/event-stream',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...authHeaders(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) throw await toApiError(res);
      if (!res.body) throw new ApiError(0, null, 'Streaming is not supported by this browser');

      onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        // Events are separated by a blank line (\n\n or \r\n\r\n).
        while ((sepIndex = findSeparator(buffer)) !== -1) {
          const rawEvent = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex).replace(/^(\r?\n){2}/, '');
          const parsed = parseEvent(rawEvent);
          if (parsed) dispatch(parsed);
        }
      }
      // flush a trailing event without terminating blank line
      const tail = parseEvent(buffer.trim());
      if (tail) dispatch(tail);
      onClose?.();
    } catch (error) {
      if (controller.signal.aborted) {
        onClose?.();
        return;
      }
      onError?.(error);
      onClose?.();
    }
  })();

  return () => controller.abort();
}

function findSeparator(buffer: string): number {
  const a = buffer.indexOf('\n\n');
  const b = buffer.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseEvent(raw: string): SseMessage | null {
  if (!raw.trim()) return null;
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }
  if (dataLines.length === 0 && event === 'message') return null;
  return { event, data: dataLines.join('\n'), id };
}
