/**
 * Consumer group detail.
 *
 * The P1 promise: membership state and processing health are *two* separate readings. A
 * "Stable" group can still be falling behind, and a group with no lag reading at all must say
 * so rather than claim it is caught up. Delete is demoted into the overflow menu behind a
 * typed confirmation.
 */
import { test, expect } from './fixtures/test';
import * as data from './fixtures/data';

const GROUP_URL = `/c/${data.CLUSTER_ID}/consumers/${data.GROUP_ORDERS}`;

test.describe('consumers / processing health', () => {
  test('a Stable group with outstanding lag shows both Stable and Falling behind', async ({
    page,
  }) => {
    await page.goto(GROUP_URL);

    const bar = page.getByText('Membership').locator('..');
    await expect(bar).toContainText('Stable');
    await expect(bar).toContainText('Processing');
    await expect(bar).toContainText('Falling behind');
    await expect(bar).not.toContainText('Caught up');
  });

  test('a group with no lag reading reports No data, never Caught up', async ({ page, api }) => {
    api.on('GET /clusters/:cluster/consumer-groups/:group', { json: data.unknownLagGroupDetail });
    api.on('GET /clusters/:cluster/consumer-groups/:group/lag-history', {
      json: data.emptyLagHistory,
    });

    await page.goto(GROUP_URL);

    const bar = page.getByText('Membership').locator('..');
    await expect(bar).toContainText('Stable');
    // `PROCESSING_HEALTH_LABEL.unknown` — the "unknown" bucket, rendered as "No data".
    await expect(bar).toContainText('No data');
    await expect(bar).not.toContainText('Caught up');
    await expect(bar).not.toContainText('Falling behind');
  });

  test('a caught-up group reads Caught up', async ({ page, api }) => {
    api.on('GET /clusters/:cluster/consumer-groups/:group', {
      json: { ...data.laggingGroupDetail, totalLag: 0 },
    });

    await page.goto(GROUP_URL);

    const bar = page.getByText('Membership').locator('..');
    await expect(bar).toContainText('Caught up');
    await expect(bar).not.toContainText('Falling behind');
  });
});

test.describe('consumers / investigation tiles', () => {
  test('the worst-partition tile names the highest-lag partition', async ({ page }) => {
    await page.goto(GROUP_URL);

    // Both investigation tiles are clickable (they jump to the matching tab), so the whole
    // tile is one accessible button whose name carries label + value + hint.
    const tile = page.getByRole('button', { name: /^Worst partition/ });
    await expect(tile).toContainText(`${data.TOPIC_ORDERS}-1`);
    await expect(tile).toContainText('lag — highest of any partition');
  });

  test('the assignment-skew tile compares the busiest and idlest members', async ({ page }) => {
    await page.goto(GROUP_URL);

    const tile = page.getByRole('button', { name: /^Assignment skew/ });
    await expect(tile).toContainText('2.0×');
    await expect(tile).toContainText('Busiest member: 4 partitions · idlest: 2');
  });

  test('the worst-partition tile has no data when every lag reading is unknown', async ({
    page,
    api,
  }) => {
    api.on('GET /clusters/:cluster/consumer-groups/:group', { json: data.unknownLagGroupDetail });

    await page.goto(GROUP_URL);

    // Both investigation tiles are clickable (they jump to the matching tab), so the whole
    // tile is one accessible button whose name carries label + value + hint.
    const tile = page.getByRole('button', { name: /^Worst partition/ });
    await expect(tile).toContainText('No data');
    await expect(tile).toContainText('No known per-partition lag reading');
  });
});

test.describe('consumers / delete', () => {
  test('Delete lives in the kebab menu and needs the group name typed', async ({ page, api }) => {
    await page.goto(GROUP_URL);

    // Not a primary action: nothing named "Delete" is on the header until the menu opens.
    await expect(page.getByRole('button', { name: 'Delete group' })).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    const item = page.getByRole('menuitem', { name: /Delete group/ });
    await expect(item).toBeVisible();
    await item.click();

    const dialog = page.getByRole('dialog', { name: 'Delete consumer group' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(data.GROUP_ORDERS);

    const confirm = dialog.getByRole('button', { name: 'Delete group' });
    await expect(confirm).toBeDisabled();

    await dialog.locator('#confirm-input').fill('not-the-group');
    await expect(confirm).toBeDisabled();

    await dialog.locator('#confirm-input').fill(data.GROUP_ORDERS);
    await expect(confirm).toBeEnabled();

    // Deliberately not confirmed — cancelling must leave the group alone.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.countOf('DELETE /clusters/:cluster/consumer-groups/:group')).toBe(0);
    await expect(page).toHaveURL(new RegExp(`consumers/${data.GROUP_ORDERS}`));
  });
});
