/**
 * Command palette (⌘K).
 *
 * The behaviour that matters when a backend is down: one unreachable source degrades to an
 * explicit "unavailable — press to retry" row while every other source keeps answering.
 * "No results" must never be a lie about a source we could not reach.
 */
import { test, expect, integrationUnavailable } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import * as data from './fixtures/data';

const OVERVIEW = `/c/${data.CLUSTER_ID}/overview`;

async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const paletteInput = (page: Page) =>
  page.getByPlaceholder('Search pages, topics, groups, connectors, jobs, schemas, alerts…');

/** Palette rows carry the app's own stable `PaletteResult.id` as cmdk's `data-value`. */
const item = (dialog: Locator, value: string) =>
  dialog.locator(`[cmdk-item][data-value="${value}"]`);

test.describe('command palette', () => {
  test('⌘K opens it and a search returns typed resource results', async ({ page }) => {
    await page.goto(OVERVIEW);

    const dialog = await openPalette(page);
    await paletteInput(page).fill('ord');

    await expect(item(dialog, `topic:${data.TOPIC_ORDERS}`)).toBeVisible();
    await expect(item(dialog, `group:${data.GROUP_ORDERS}`)).toBeVisible();
    await expect(item(dialog, `schema:${data.SCHEMA_ORDERS}`)).toBeVisible();

    const headings = dialog.locator('[cmdk-group-heading]');
    await expect(headings.filter({ hasText: 'Topics' })).toBeVisible();
    await expect(headings.filter({ hasText: 'Consumer groups' })).toBeVisible();
  });

  test('a failed source shows a retry row while other results stay usable', async ({
    page,
    api,
  }) => {
    api.on('GET /clusters/:cluster/connect', integrationUnavailable('Connect REST API is down'));

    await page.goto(OVERVIEW);
    const dialog = await openPalette(page);
    await paletteInput(page).fill('ord');

    const retryRow = item(dialog, 'retry-connector');
    await expect(retryRow).toContainText('Connect unavailable — press to retry');
    await expect(
      dialog.getByText('Partial results — Connect could not be searched.'),
    ).toBeVisible();

    // Everything else still answers — a broken Connect does not blank the palette.
    await expect(item(dialog, `topic:${data.TOPIC_ORDERS}`)).toBeVisible();
    await expect(item(dialog, `group:${data.GROUP_ORDERS}`)).toBeVisible();

    // Heal the backend, then press the retry row: the source recovers in place.
    api.on('GET /clusters/:cluster/connect', { json: data.connectClusters });
    const before = api.countOf('GET /clusters/:cluster/connect');
    await retryRow.click();

    await expect(retryRow).toHaveCount(0);
    expect(api.countOf('GET /clusters/:cluster/connect')).toBeGreaterThan(before);
    await expect(dialog).toBeVisible();
    await expect(item(dialog, `topic:${data.TOPIC_ORDERS}`)).toBeVisible();
  });

  test('the "s:" prefix narrows the search to schemas', async ({ page }) => {
    await page.goto(OVERVIEW);
    const dialog = await openPalette(page);

    await paletteInput(page).fill('s: user');

    const headings = dialog.locator('[cmdk-group-heading]');
    await expect(headings.filter({ hasText: 'Schemas' })).toBeVisible();
    await expect(item(dialog, `schema:${data.SCHEMA_USERS}`)).toBeVisible();

    await expect(headings.filter({ hasText: 'Topics' })).toHaveCount(0);
    await expect(headings.filter({ hasText: 'Consumer groups' })).toHaveCount(0);
    await expect(headings.filter({ hasText: 'Flink jobs' })).toHaveCount(0);
  });

  test('selecting a schema result navigates to that subject', async ({ page }) => {
    await page.goto(OVERVIEW);
    const dialog = await openPalette(page);

    await paletteInput(page).fill('s: user');
    await item(dialog, `schema:${data.SCHEMA_USERS}`).click();

    await page.waitForURL(`**/c/${data.CLUSTER_ID}/schemas/${data.SCHEMA_USERS}`);
    await expect(dialog).toHaveCount(0);
  });

  test('the "t:" prefix result navigates to the topic detail route', async ({ page }) => {
    await page.goto(OVERVIEW);
    const dialog = await openPalette(page);

    await paletteInput(page).fill('t: orders');
    await item(dialog, `topic:${data.TOPIC_ORDERS}`).click();

    await page.waitForURL(`**/c/${data.CLUSTER_ID}/topics/${data.TOPIC_ORDERS}`);
  });
});
