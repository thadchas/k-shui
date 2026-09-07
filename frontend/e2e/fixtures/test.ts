/**
 * Shared test fixture: a signed-in admin, deterministic UI state, and the mocked API.
 *
 * Usage:
 * ```ts
 * test('…', async ({ page, api }) => {
 *   api.on('GET /clusters/:cluster/flink', integrationUnavailable('Flink is down'));
 *   await page.goto('/c/local/overview');
 * });
 * ```
 * Overrides must be registered before `page.goto`; the router picks the newest match.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { ApiMock, attachApiMock } from './api-mock';
import { registerDefaultRoutes } from './routes';
import { ADMIN_TOKEN, ADMIN_USER } from './data';

/** Shape zustand's `persist` middleware writes to localStorage. */
function persisted(state: unknown, version = 0): string {
  return JSON.stringify({ state, version });
}

/**
 * Seeds the persisted stores before any app code runs:
 *  - `kshui.auth`  — a signed-in admin, so no login redirect and no disabled controls.
 *  - `kshui.ui`    — background refresh OFF. Polling would re-run queries mid-assertion and
 *                    make "unavailable → retry" and lag-persistence tests non-deterministic.
 */
async function seedAppState(page: Page): Promise<void> {
  await page.addInitScript(
    ([authKey, uiKey, authValue, uiValue]: string[]) => {
      window.localStorage.setItem(authKey, authValue);
      window.localStorage.setItem(uiKey, uiValue);
    },
    [
      'kshui.auth',
      'kshui.ui',
      persisted({ token: ADMIN_TOKEN, user: ADMIN_USER }),
      persisted({ sidebarCollapsed: false, refreshInterval: 0, lastClusterId: null }),
    ],
  );
}

export const test = base.extend<{ api: ApiMock }>({
  // `auto` so the mocks and the seeded session are installed even in tests that never name
  // the `api` fixture — otherwise those tests would hit the dev server bare and 404.
  api: [
    async ({ page }, use) => {
      await seedAppState(page);
      const api = new ApiMock();
      registerDefaultRoutes(api);
      await attachApiMock(page, api);
      await use(api);
    },
    { auto: true },
  ],
});

export { expect };
export { integrationUnavailable, problem, sseBody } from './api-mock';
