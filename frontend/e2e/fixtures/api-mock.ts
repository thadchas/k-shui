/**
 * Tiny request-router for Playwright route interception.
 *
 * The whole e2e suite is hermetic: no backend process, no Kafka. Every request the app makes
 * to `/api/v1/**` is answered here from in-memory fixtures. Anything a test forgets to mock
 * gets an explicit 404 problem+json ("has no e2e mock") rather than escaping to the network,
 * so a missing fixture fails loudly instead of silently hitting a developer's live server.
 */
import type { Page, Route, Request } from '@playwright/test';

export const API_PREFIX = '/api/v1';

export interface MockResponse {
  status?: number;
  /** Serialized as the JSON body. Ignored when `body` is set. */
  json?: unknown;
  /** Raw body (used for SSE streams). */
  body?: string;
  contentType?: string;
  /** Milliseconds to wait before answering — lets a test observe an in-flight state. */
  delay?: number;
}

export interface MockContext {
  url: URL;
  method: string;
  /** Path params captured from the route pattern, already URL-decoded. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Raw request body, if any. */
  body: string | null;
  /** 1-based index of this call against this handler — makes "fail once, then succeed" easy. */
  callIndex: number;
}

export type Responder = MockResponse | ((ctx: MockContext) => MockResponse | Promise<MockResponse>);

interface Registered {
  spec: string;
  method: string;
  segments: string[];
  responder: Responder;
  calls: number;
}

export interface RecordedRequest {
  method: string;
  /** Path with the `/api/v1` prefix removed. */
  path: string;
  search: string;
  body: string | null;
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** `'GET /clusters/:cluster/topics'` → `{ method, segments }`. */
function parseSpec(spec: string): { method: string; segments: string[] } {
  const gap = spec.indexOf(' ');
  if (gap === -1) throw new Error(`Invalid route spec (expected "METHOD /path"): ${spec}`);
  return {
    method: spec.slice(0, gap).trim().toUpperCase(),
    segments: splitPath(spec.slice(gap + 1).trim()),
  };
}

/**
 * Segment matcher. `:name` captures one segment, a trailing `*` captures the rest.
 * Returns the captured params, or `null` when the pattern does not apply.
 */
function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i += 1) {
    const token = pattern[i];
    if (token === '*') return params;
    if (i >= actual.length) return null;
    if (token.startsWith(':')) {
      params[token.slice(1)] = decodeURIComponent(actual[i]);
      continue;
    }
    if (token !== actual[i]) return null;
  }
  return pattern.length === actual.length ? params : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** RFC 9457 problem+json body, the shape `ApiError` parses. */
export function problem(status: number, title: string, detail: string, type?: string) {
  return {
    status,
    contentType: 'application/problem+json',
    json: { type: type ?? 'about:blank', title, status, detail },
  } satisfies MockResponse;
}

/** 503 with the `integration-unavailable` type — react-query never retries these. */
export function integrationUnavailable(detail: string): MockResponse {
  return problem(
    503,
    'Integration unavailable',
    detail,
    'https://k-shui.dev/problems/integration-unavailable',
  );
}

/** Server-Sent-Events body for the message stream (`event:`/`data:` pairs). */
export function sseBody(events: { event: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

export class ApiMock {
  /** Newest registration wins, so a test can override any default. */
  private readonly handlers: Registered[] = [];
  readonly requests: RecordedRequest[] = [];

  on(spec: string, responder: Responder): this {
    const { method, segments } = parseSpec(spec);
    this.handlers.unshift({ spec, method, segments, responder, calls: 0 });
    return this;
  }

  /** How many requests matched `spec` so far (counted from the request log, not the handler). */
  countOf(spec: string): number {
    const { method, segments } = parseSpec(spec);
    return this.requests.filter(
      (r) => r.method === method && matchSegments(segments, splitPath(r.path)) !== null,
    ).length;
  }

  /** Every request that matched `spec`, oldest first. */
  matching(spec: string): RecordedRequest[] {
    const { method, segments } = parseSpec(spec);
    return this.requests.filter(
      (r) => r.method === method && matchSegments(segments, splitPath(r.path)) !== null,
    );
  }

  async handle(route: Route, request: Request): Promise<void> {
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (!url.pathname.startsWith(API_PREFIX)) {
      await route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Not an API route', status: 404, detail: url.pathname }),
      });
      return;
    }

    const path = url.pathname.slice(API_PREFIX.length) || '/';
    const body = request.postData();
    this.requests.push({ method, path, search: url.search, body });

    const actual = splitPath(path);
    for (const handler of this.handlers) {
      if (handler.method !== method && handler.method !== 'ANY') continue;
      const params = matchSegments(handler.segments, actual);
      if (!params) continue;
      handler.calls += 1;
      const response =
        typeof handler.responder === 'function'
          ? await handler.responder({
              url,
              method,
              params,
              query: url.searchParams,
              body,
              callIndex: handler.calls,
            })
          : handler.responder;
      if (response.delay) await sleep(response.delay);
      await route.fulfill({
        status: response.status ?? 200,
        contentType: response.contentType ?? 'application/json',
        headers: { 'cache-control': 'no-store' },
        body: response.body ?? JSON.stringify(response.json ?? null),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Not mocked',
        status: 404,
        detail: `${method} ${path} has no e2e mock`,
      }),
    });
  }
}

/**
 * Attach the router to a page. Must run before the first navigation.
 *
 * Matched with a URL predicate rather than a glob: `**\/api\/**` would also swallow the dev
 * server's own module requests (`/src/api/client.ts`) and leave the app unable to boot.
 */
export async function attachApiMock(page: Page, api: ApiMock): Promise<void> {
  await page.route(
    (url) => url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`),
    (route, request) => api.handle(route, request),
  );
}
