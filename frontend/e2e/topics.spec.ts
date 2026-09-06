/**
 * Topics list — views, saved views, column preferences and the copy affordance.
 *
 * The P1 promise: an operator can jump to "the topics that are broken" in one click, name and
 * re-open their own view later (surviving a reload), and copy a long topic name that the
 * table has to truncate.
 */
import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import * as data from './fixtures/data';

const TOPICS = `/c/${data.CLUSTER_ID}/topics`;

/** Body rows of the topics table (rows carry role="link", so `tbody tr` is the stable handle). */
const bodyRows = (page: Page) => page.locator('table tbody tr');

async function openViews(page: Page) {
  await page.getByRole('button', { name: /^Views?$|^View: / }).click();
}

test.describe('topics / views', () => {
  test('the Unhealthy preset filters the table down to topics with URPs', async ({ page }) => {
    await page.goto(TOPICS);
    await expect(bodyRows(page)).toHaveCount(3);

    await openViews(page);
    await page.getByRole('menuitem', { name: /^Unhealthy/ }).click();

    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText(data.TOPIC_PAYMENTS);
    await expect(page.locator('table')).not.toContainText(data.TOPIC_LONG);

    // The active view is named in the trigger, and its caveat is spelled out.
    await expect(page.getByRole('button', { name: 'View: Unhealthy' })).toBeVisible();
    await expect(
      page.getByText(/Offline-partition and min-ISR-breach counts are not exposed/),
    ).toBeVisible();
  });

  test('the High traffic preset hides idle topics', async ({ page }) => {
    await page.goto(TOPICS);

    await openViews(page);
    await page.getByRole('menuitem', { name: /^High traffic/ }).click();

    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page.locator('table')).toContainText(data.TOPIC_ORDERS);
    // payments.v2 has no measured throughput in the fixture.
    await expect(page.locator('table')).not.toContainText(data.TOPIC_PAYMENTS);
  });

  test('a named saved view survives a reload and reapplies its filters', async ({ page }) => {
    await page.goto(TOPICS);

    await page.getByPlaceholder('Search topics…').fill('payments');
    await expect(bodyRows(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Save view' }).click();
    await page.locator('#topics-save-view-name').fill('Payments only');
    // The popover's submit button shares its label with the trigger — scope to the form.
    await page
      .locator('form:has(#topics-save-view-name)')
      .getByRole('button', { name: 'Save view' })
      .click();

    // Saving marks the view active on the trigger.
    await expect(page.getByRole('button', { name: 'View: Payments only' })).toBeVisible();

    await openViews(page);
    await expect(page.getByRole('button', { name: 'Payments only', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Come back with a clean URL — no filters carried over.
    await page.goto(TOPICS);
    await expect(page.getByPlaceholder('Search topics…')).toHaveValue('');
    await expect(bodyRows(page)).toHaveCount(3);

    await openViews(page);
    await page.getByRole('button', { name: 'Payments only', exact: true }).click();

    await expect(page.getByPlaceholder('Search topics…')).toHaveValue('payments');
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText(data.TOPIC_PAYMENTS);
    await expect(page).toHaveURL(/[?&]q=payments/);
    // Restoring re-marks the view as active — its own filters flowing back through the
    // table's controlled handlers must not clear it.
    await expect(page.getByRole('button', { name: 'View: Payments only' })).toBeVisible();
  });
});

test.describe('topics / columns', () => {
  test('hiding a column persists across a reload, pinned columns stay', async ({ page }) => {
    await page.goto(TOPICS);

    const headers = page.locator('table thead th');
    await expect(headers.filter({ hasText: 'Retention' })).toBeVisible();

    await page.getByRole('button', { name: 'Columns' }).click();
    await page.locator('#topics-col-retentionMs').click();
    await page.keyboard.press('Escape');

    await expect(headers.filter({ hasText: 'Retention' })).toHaveCount(0);

    await page.reload();

    await expect(page.locator('table thead th').filter({ hasText: 'Retention' })).toHaveCount(0);
    // Name and Health are pinned and can never be hidden.
    await expect(page.locator('table thead th').filter({ hasText: 'Topic name' })).toBeVisible();
    await expect(page.locator('table thead th').filter({ hasText: 'Health' })).toBeVisible();
  });
});

const CLIPBOARD_KEY = '__e2e.clipboard';

test.describe('topics / copy', () => {
  test('the copy button copies the full name without leaving the list', async ({ page }) => {
    // The real `navigator.clipboard` only resolves for a focused document — not guaranteed
    // for a headless page sharing a machine with other workers — so record what the app
    // *asks* the clipboard to store instead.
    await page.addInitScript((key: string) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            window.localStorage.setItem(key, text);
            return Promise.resolve();
          },
        },
      });
    }, CLIPBOARD_KEY);

    await page.goto(TOPICS);

    const row = bodyRows(page).filter({ hasText: data.TOPIC_LONG });
    await expect(row).toHaveCount(1);
    // The name cell truncates with CSS; the full value still has to reach the clipboard.
    await row.getByRole('button', { name: 'Copy topic name' }).click();

    await expect
      .poll(() => page.evaluate((key: string) => window.localStorage.getItem(key), CLIPBOARD_KEY))
      .toBe(data.TOPIC_LONG);
    // Copying must not follow the row link.
    await expect(page).toHaveURL(/\/topics(\?|$)/);
    await expect(bodyRows(page).first()).toBeVisible();
  });
});
