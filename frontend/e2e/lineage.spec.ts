/**
 * Stream lineage — the Graph | List toggle and `?focus=` deep links.
 *
 * The P1 promise: an operator can read a resource's upstream/downstream dependencies as a
 * plain table, without panning or zooming a canvas, and a deep link lands already focused on
 * the resource that was linked.
 */
import { test, expect } from './fixtures/test';
import * as data from './fixtures/data';

const LINEAGE = `/c/${data.CLUSTER_ID}/lineage`;
const FOCUSED = `${LINEAGE}?focus=${encodeURIComponent(data.LINEAGE_FOCUS)}`;

test.describe('lineage / deep link', () => {
  test('?focus= lands with the resource selected as the focus', async ({ page }) => {
    await page.goto(FOCUSED);

    const focusBox = page.getByRole('button', { name: 'Clear focus' }).locator('..');
    await expect(focusBox).toContainText(data.TOPIC_ORDERS);
    await expect(page.getByText('Hops from the focused node.')).toBeVisible();
  });

  test('without ?focus= the depth control is disabled and List explains why', async ({ page }) => {
    await page.goto(LINEAGE);

    await expect(page.locator('#lineage-depth')).toBeDisabled();
    await expect(page.getByText('Focus a node to limit depth.')).toBeVisible();

    await page.getByRole('tab', { name: 'Dependency list view' }).click();
    await expect(page.getByText('Focus a resource to list its dependencies')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to Graph' })).toBeVisible();
  });
});

test.describe('lineage / list view', () => {
  test('List renders upstream and downstream rows with no canvas', async ({ page }) => {
    await page.goto(FOCUSED);

    // The canvas is the default view…
    await expect(page.locator('.react-flow')).toBeVisible();

    await page.getByRole('tab', { name: 'Dependency list view' }).click();

    // …and the list replaces it entirely — nothing to pan or zoom.
    await expect(page.locator('.react-flow')).toHaveCount(0);

    await expect(page.getByText(`Dependencies of ${data.TOPIC_ORDERS}`)).toBeVisible();

    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3);

    const upstream = rows.filter({ hasText: data.CONNECTOR_SOURCE });
    await expect(upstream).toHaveCount(1);
    await expect(upstream).toContainText('upstream');
    await expect(upstream).toContainText('Connector');

    await expect(rows.filter({ hasText: data.GROUP_ORDERS })).toContainText('downstream');
    await expect(rows.filter({ hasText: data.FLINK_JOB_NAME })).toContainText('downstream');

    // Upstream is listed before downstream.
    await expect(rows.nth(0)).toContainText('upstream');
    await expect(rows.nth(1)).toContainText('downstream');
    await expect(rows.nth(2)).toContainText('downstream');
  });

  test('a list row links to the feature page that owns the node', async ({ page }) => {
    await page.goto(FOCUSED);
    await page.getByRole('tab', { name: 'Dependency list view' }).click();

    await page
      .getByRole('link', { name: `Open ${data.GROUP_ORDERS} detail page` })
      .or(page.getByRole('button', { name: `Open ${data.GROUP_ORDERS} detail page` }))
      .click();

    await page.waitForURL(`**/c/${data.CLUSTER_ID}/consumers/${data.GROUP_ORDERS}`);
  });

  test('clicking a list row refocuses lineage on that node', async ({ page }) => {
    await page.goto(FOCUSED);
    await page.getByRole('tab', { name: 'Dependency list view' }).click();

    await page.locator('table tbody tr').filter({ hasText: data.CONNECTOR_SOURCE }).click();

    await expect(page).toHaveURL(
      /focus=connector%3Alocal%3Aconnect-1%3App?g-source|focus=connector/,
    );
    await expect(page.getByText(`Dependencies of ${data.CONNECTOR_SOURCE}`)).toBeVisible();
  });
});
