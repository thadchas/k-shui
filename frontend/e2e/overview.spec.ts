/**
 * Cluster overview — the "Needs attention" queue.
 *
 * Covers the P1 promise that the queue is *ranked* (partitions → failed services → lag), that
 * a telemetry source which failed is shown as an explicit unavailable row with a working
 * retry, that the all-clear is only claimed when all four sources answered, and that a row
 * links to the exact resource page.
 */
import { test, expect, integrationUnavailable } from './fixtures/test';
import * as data from './fixtures/data';

const OVERVIEW = `/c/${data.CLUSTER_ID}/overview`;

/** Every attention row, in render order. */
const rows = (page: import('@playwright/test').Page) => page.getByTestId('attention-item');

test.describe('overview / needs attention', () => {
  test('ranks offline partitions, then URPs, then failed services, then sustained lag', async ({
    page,
    api,
  }) => {
    api.on('GET /clusters/:cluster/partitions/unhealthy', { json: data.unhealthyPartitions });
    api.on('GET /clusters/:cluster/connect/:kc/connectors', { json: data.failedConnectors });
    api.on('GET /clusters/:cluster/flink/:fc/jobs', { json: data.failedFlinkJobs });
    api.on('GET /clusters/:cluster/consumer-groups', { json: data.laggingGroups });

    await page.goto(OVERVIEW);

    const queue = page.getByTestId('needs-attention');
    await expect(queue.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    await expect(rows(page)).toHaveCount(5);

    // tier 0 critical → tier 0 warning → tier 1 (connector outranks the job on magnitude) → tier 2
    await expect(rows(page).nth(0)).toContainText(data.TOPIC_PAYMENTS);
    await expect(rows(page).nth(0)).toContainText('2 offline partitions');
    await expect(rows(page).nth(0)).toContainText('critical');

    await expect(rows(page).nth(1)).toContainText(data.TOPIC_ORDERS);
    await expect(rows(page).nth(1)).toContainText('2 under-replicated partitions');
    await expect(rows(page).nth(1)).toContainText('warning');

    await expect(rows(page).nth(2)).toContainText(data.CONNECTOR_SINK);
    await expect(rows(page).nth(2)).toContainText('connector FAILED');

    await expect(rows(page).nth(3)).toContainText(data.FLINK_JOB_NAME);
    await expect(rows(page).nth(3)).toContainText('job FAILED');

    await expect(rows(page).nth(4)).toContainText(data.GROUP_ORDERS);
    await expect(rows(page).nth(4)).toContainText(/lag/);

    // A non-preferred-leader partition is present in the fixture but must not be queued.
    await expect(rows(page)).toHaveCount(5);
  });

  test('a failed source becomes an unavailable row whose retry refetches it', async ({
    page,
    api,
  }) => {
    // Fails the first time only, so the retry can be observed recovering.
    api.on('GET /clusters/:cluster/flink', (ctx) =>
      ctx.callIndex === 1
        ? integrationUnavailable('Flink REST gateway is unreachable')
        : { json: data.flinkClusters },
    );

    await page.goto(OVERVIEW);

    const flinkRow = page.locator('[data-attention-source="flink"]');
    await expect(flinkRow).toContainText('Flink');
    await expect(flinkRow).toContainText('Flink telemetry failed to load');
    await expect(flinkRow).toContainText('unavailable');

    // Missing telemetry must never be reported as an all-clear.
    await expect(page.getByText('Nothing needs attention')).toHaveCount(0);

    const before = api.countOf('GET /clusters/:cluster/flink');
    await flinkRow.getByRole('button', { name: 'Retry' }).click();

    await expect(flinkRow).toHaveCount(0);
    expect(api.countOf('GET /clusters/:cluster/flink')).toBeGreaterThan(before);
    await expect(page.getByText('Nothing needs attention')).toBeVisible();
  });

  test('claims the all-clear only when all four sources loaded cleanly', async ({ page }) => {
    await page.goto(OVERVIEW);

    await expect(page.getByText('Nothing needs attention')).toBeVisible();
    await expect(
      page.getByText(
        'Partitions, connectors, Flink jobs and consumer lag all checked out healthy.',
      ),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test('a queued item links to the exact resource page', async ({ page, api }) => {
    api.on('GET /clusters/:cluster/connect/:kc/connectors', { json: data.failedConnectors });

    await page.goto(OVERVIEW);

    const connectorRow = page.locator('[data-attention-source="connect"]');
    await expect(connectorRow).toContainText(data.CONNECTOR_SINK);
    await connectorRow.click();

    await page.waitForURL(
      `**/c/${data.CLUSTER_ID}/connect/${data.CONNECT_CLUSTER}/connectors/${data.CONNECTOR_SINK}`,
    );
  });

  test('a partition item links to the topic partitions tab', async ({ page, api }) => {
    api.on('GET /clusters/:cluster/partitions/unhealthy', { json: data.unhealthyPartitions });

    await page.goto(OVERVIEW);

    await page.locator('[data-attention-source="partitions"]').first().click();

    await page.waitForURL(`**/c/${data.CLUSTER_ID}/topics/${data.TOPIC_PAYMENTS}?tab=partitions`);
  });
});
