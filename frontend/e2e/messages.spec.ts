/**
 * Topic detail → Messages tab.
 *
 * The P1 promise: the browser always says what it is doing in words (Idle / Fetching /
 * Stopped / Live / Paused), never hides a non-default query option silently (the Advanced
 * badge), and can save + restore a query configuration by name.
 *
 * The message stream is SSE over `fetch` + ReadableStream, so a `text/event-stream` body
 * fulfilled by Playwright is a faithful mock of a bounded read. See the tail-mode note below
 * for what is deliberately *not* covered.
 */
import { test, expect } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import * as data from './fixtures/data';
import { messagesStream } from './fixtures/routes';

const MESSAGES_URL = `/c/${data.CLUSTER_ID}/topics/${data.TOPIC_ORDERS}?tab=messages`;

const status = (page: Page): Locator => page.getByTestId('message-stream-status');
const filterInput = (page: Page) => page.locator('#msg-filter');

test.describe('messages / consumption status', () => {
  test('reads Idle → Fetching → Stopped across one bounded query', async ({ page, api }) => {
    // A deliberate delay so the in-flight "Fetching" state is observable.
    api.on('GET /clusters/:cluster/topics/:topic/messages', (ctx) =>
      ctx.query.get('stream') === 'true'
        ? { contentType: 'text/event-stream', body: messagesStream(), delay: 1_500 }
        : { json: { items: [], scanned: 0 } },
    );

    await page.goto(MESSAGES_URL);

    await expect(status(page)).toContainText('Idle');
    await expect(status(page)).toContainText('No query running');

    await page.getByRole('button', { name: 'Fetch', exact: true }).click();

    await expect(status(page)).toContainText('Fetching');
    await expect(status(page)).toContainText('Reading records from the topic');

    await expect(status(page)).toContainText('Stopped');
    await expect(status(page)).toContainText('Query finished — results held');

    // The records the stream delivered are on screen (the key cell is a "follow key" button).
    await expect(page.getByRole('button', { name: 'ord-1001', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ord-1002', exact: true })).toBeVisible();
  });
});

test.describe('messages / advanced disclosure', () => {
  test('badges the number of non-default options hidden behind Advanced', async ({ page }) => {
    await page.goto(MESSAGES_URL);

    const advanced = page.getByRole('button', { name: 'Advanced query options' });
    await expect(advanced).toBeVisible();

    await advanced.click();
    await expect(page.locator('#messages-advanced')).toBeVisible();

    await page.getByRole('combobox', { name: 'Maximum records' }).click();
    await page.getByRole('option', { name: '250' }).click();

    // The badge (and the accessible name) name exactly what is hidden.
    const badged = page.getByRole('button', {
      name: 'Advanced query options, 1 non-default: Limit: 250',
    });
    await expect(badged).toBeVisible();
    await expect(badged).toContainText('1');

    // A second non-default value bumps the count.
    await page.getByRole('combobox', { name: 'Value encoding' }).click();
    await page.getByRole('option', { name: 'json', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /Advanced query options, 2 non-default/ }),
    ).toBeVisible();
  });

  test('shows no badge while every advanced option is at its default', async ({ page }) => {
    await page.goto(MESSAGES_URL);

    await expect(page.getByRole('button', { name: 'Advanced query options' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Advanced query options, \d+ non-default/ }),
    ).toHaveCount(0);
  });
});

test.describe('messages / saved searches', () => {
  test('a saved search round-trips through a reload and restores the query config', async ({
    page,
  }) => {
    await page.goto(MESSAGES_URL);

    await filterInput(page).fill('ERROR');
    await page.getByRole('button', { name: 'Advanced query options' }).click();
    await page.getByRole('combobox', { name: 'Filter match mode' }).click();
    await page.getByRole('option', { name: 'regex' }).click();

    await page.getByRole('button', { name: 'Saved searches' }).click();
    await page.locator('#saved-search-name').fill('Failed orders');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved "Failed orders"')).toBeVisible();

    await page.reload();

    await expect(filterInput(page)).toHaveValue('');
    const trigger = page.getByRole('button', { name: 'Saved searches' });
    await expect(trigger).toContainText('1');

    await trigger.click();
    // The row's own button carries the name plus a config summary; the sibling is Delete.
    await page.getByRole('button', { name: /^Failed orders / }).click();

    await expect(filterInput(page)).toHaveValue('ERROR');
    await page.getByRole('button', { name: /Advanced query options/ }).click();
    await expect(page.getByRole('combobox', { name: 'Filter match mode' })).toContainText('regex');
    await expect(status(page)).not.toContainText('Idle');
  });
});

test.describe('messages / JSON field columns', () => {
  test('promotes a JSON value field to its own table column', async ({ page }) => {
    await page.goto(MESSAGES_URL);
    await page.getByRole('button', { name: 'Fetch', exact: true }).click();
    await expect(status(page)).toContainText('Stopped');

    await page.getByRole('button', { name: 'JSON field columns' }).click();
    await page.locator('#field-column-path').fill('status');
    await page.locator('#field-column-path').press('Enter');
    await page.keyboard.press('Escape');

    await expect(page.locator('table thead th').filter({ hasText: 'status' })).toBeVisible();
    await expect(page.locator('table tbody')).toContainText('PLACED');
    await expect(page.locator('table tbody')).toContainText('ERROR');
  });
});

/**
 * Live tail (`mode=tail`) is intentionally not asserted here.
 *
 * A faithful tail mock needs a response that stays open indefinitely; Playwright's
 * `route.fulfill` only serves a complete body, so the stream would close immediately and the
 * UI would settle into "Stopped" — the opposite of what the Live/Paused states mean. Rather
 * than assert a state the mock cannot honestly produce, the Live/Paused transitions are left
 * to the existing unit test (src/pages/topics/components/MessageStreamStatus.test.tsx) and
 * `consumptionStatus` in messageSearch.test.ts.
 */
