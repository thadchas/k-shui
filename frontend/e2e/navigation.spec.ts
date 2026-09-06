/**
 * Navigation shell — pinned/recent resources, the scope badge, and the cluster switcher.
 *
 * The promise under test: an operator can always tell *what* they are looking at (scope
 * badge), get back to what they were just looking at (Recent), keep what matters (Pinned,
 * across reloads), and switch cluster without silently inheriting the old cluster's resource.
 */
import { test, expect } from './fixtures/test';
import * as data from './fixtures/data';

const TOPIC_URL = `/c/${data.CLUSTER_ID}/topics/${data.TOPIC_ORDERS}`;

test.describe('navigation / recents and pins', () => {
  test('visiting a topic detail records it under Recent', async ({ page }) => {
    await page.goto(`/c/${data.CLUSTER_ID}/overview`);
    await expect(page.getByTestId('resource-section-recent')).toHaveCount(0);

    await page.goto(TOPIC_URL);

    const recent = page.getByTestId('resource-section-recent');
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('link', { name: data.TOPIC_ORDERS })).toBeVisible();
  });

  test('pinning moves a resource to Pinned and survives a reload', async ({ page }) => {
    await page.goto(TOPIC_URL);

    const recent = page.getByTestId('resource-section-recent');
    await expect(recent.getByRole('link', { name: data.TOPIC_ORDERS })).toBeVisible();

    await page.getByRole('button', { name: `Pin topic ${data.TOPIC_ORDERS}` }).click();

    const pinned = page.getByTestId('resource-section-pinned');
    await expect(pinned.getByRole('link', { name: data.TOPIC_ORDERS })).toBeVisible();
    // The entry is not listed twice — Recent drops what is pinned.
    await expect(page.getByTestId('resource-section-recent')).toHaveCount(0);

    await page.reload();

    const pinnedAfter = page.getByTestId('resource-section-pinned');
    await expect(pinnedAfter.getByRole('link', { name: data.TOPIC_ORDERS })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Unpin topic ${data.TOPIC_ORDERS}` }),
    ).toBeVisible();
  });

  test('pins are cluster-scoped — another cluster does not inherit them', async ({ page }) => {
    await page.goto(TOPIC_URL);
    await page.getByRole('button', { name: `Pin topic ${data.TOPIC_ORDERS}` }).click();
    await expect(page.getByTestId('resource-section-pinned')).toBeVisible();

    await page.goto(`/c/${data.OTHER_CLUSTER_ID}/overview`);

    await expect(page.getByTestId('resource-section-pinned')).toHaveCount(0);
    await expect(page.getByTestId('resource-section-recent')).toHaveCount(0);
  });
});

test.describe('navigation / scope badge', () => {
  test('names the cluster on a cluster route', async ({ page }) => {
    await page.goto(`/c/${data.CLUSTER_ID}/overview`);

    const badge = page.getByTitle(/^Scope: cluster/);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(data.CLUSTER_NAME);
    await expect(badge).toHaveAttribute('title', new RegExp(`cluster ${data.CLUSTER_NAME}`));
  });

  test('says "All clusters" on a global route', async ({ page }) => {
    await page.goto('/alerts');

    const badge = page.getByTitle(/^Scope: all clusters/);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('All clusters');
    await expect(page.getByTitle(/^Scope: cluster/)).toHaveCount(0);
  });
});

test.describe('navigation / cluster switcher', () => {
  test('maps a resource page to that section in the target cluster', async ({ page }) => {
    await page.goto(TOPIC_URL);

    await page.getByRole('combobox', { name: 'Switch cluster' }).click();

    // The switcher says out loud what the switch drops.
    await expect(page.getByText(`Switching cluster leaves ${data.TOPIC_ORDERS}`)).toBeVisible();
    await expect(page.getByText(/opens Topics in the cluster you pick/)).toBeVisible();

    await page.getByRole('option', { name: new RegExp(data.OTHER_CLUSTER_NAME) }).click();

    await page.waitForURL(`**/c/${data.OTHER_CLUSTER_ID}/topics`);
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  });

  test('keeps the section when switching from a list page', async ({ page }) => {
    await page.goto(`/c/${data.CLUSTER_ID}/consumers`);

    await page.getByRole('combobox', { name: 'Switch cluster' }).click();
    await page.getByRole('option', { name: new RegExp(data.OTHER_CLUSTER_NAME) }).click();

    await page.waitForURL(`**/c/${data.OTHER_CLUSTER_ID}/consumers`);
  });
});
