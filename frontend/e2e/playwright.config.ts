import { defineConfig, devices } from '@playwright/test';

/**
 * Hermetic UI end-to-end suite.
 *
 * No backend and no Kafka: the frontend runs against a Vite dev server with the API proxy
 * removed (see vite.e2e.config.ts) and every `/api/**` call is answered by Playwright route
 * interception (see fixtures/api-mock.ts). Nothing here talks to a real cluster, so the suite
 * is safe to run alongside a live k-shui.
 */
const E2E_PORT = Number(process.env.KSHUI_E2E_PORT ?? 5191);
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npx vite --config e2e/vite.e2e.config.ts',
    cwd: '..',
    url: BASE_URL,
    env: { KSHUI_E2E_PORT: String(E2E_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
