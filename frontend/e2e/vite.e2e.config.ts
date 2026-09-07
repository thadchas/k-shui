import { defineConfig, type UserConfig } from 'vite';
import baseConfig from '../vite.config.ts';

/**
 * Dev server used by the hermetic Playwright suite.
 *
 * Identical to the app's Vite config except that the `/api`, `/healthz`, `/readyz` and
 * `/metrics` proxies are removed: the e2e suite serves every backend call from Playwright
 * route interception, and a proxy would let an un-mocked request escape to whatever happens
 * to be listening on the developer's machine.
 *
 * The port is deliberately outside the app's normal range (see `E2E_PORT` in
 * playwright.config.ts) so a running `npm run dev` / backend is never disturbed.
 */
const base = baseConfig as UserConfig;

export const E2E_PORT = Number(process.env.KSHUI_E2E_PORT ?? 5191);

export default defineConfig({
  ...base,
  server: {
    ...base.server,
    proxy: undefined,
    port: E2E_PORT,
    strictPort: true,
    host: '127.0.0.1',
  },
});
