/**
 * Guided connection tester (Clusters → "Test a connection").
 *
 * The P1 promise for onboarding: each component is probed on its own, a failure says *which
 * layer* broke (connectivity / credentials / permissions) instead of one opaque error, and the
 * dialog hands back the YAML fragment to apply — k-shui never writes the cluster inventory.
 */
import { test, expect } from './fixtures/test';
import * as data from './fixtures/data';

const CLUSTERS = '/clusters';

async function openTester(page: import('@playwright/test').Page) {
  await page.goto(CLUSTERS);
  await page.getByRole('button', { name: 'Test a connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Test a connection' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('connection tester', () => {
  test('renders per-component results with a failure category for each layer', async ({
    page,
    api,
  }) => {
    api.on('POST /system/connection-test', { json: data.connectionTestPartial });

    const dialog = await openTester(page);

    await dialog.getByLabel('Cluster id').fill('local');
    await dialog.getByLabel('Bootstrap servers').fill('broker-1:9092');
    await dialog.getByLabel('Schema Registry URL').fill('http://schema-registry:8081');
    await dialog.getByLabel('Kafka Connect URL').fill('http://connect:8083');

    await dialog.getByRole('button', { name: 'Run test' }).click();

    // The request carried the flat form fields as the nested contract shape.
    await expect.poll(() => api.countOf('POST /system/connection-test')).toBe(1);
    const sent = JSON.parse(api.matching('POST /system/connection-test')[0].body ?? '{}');
    expect(sent.clusterId).toBe('local');
    expect(sent.bootstrapServers).toBe('broker-1:9092');
    expect(sent.schemaRegistry.url).toBe('http://schema-registry:8081');

    const results = dialog.locator('li').filter({ hasText: 'Kafka' });
    await expect(dialog.getByText('Needs attention')).toBeVisible();

    const kafka = dialog.locator('li').filter({ hasText: 'broker-1:9092' });
    await expect(kafka).toContainText('OK');
    await expect(kafka).toContainText('Connected and described the cluster.');
    await expect(kafka).toContainText('brokers 3');

    const registry = dialog.locator('li').filter({ hasText: 'http://schema-registry:8081' });
    await expect(registry).toContainText('Credentials · Auth failed');
    await expect(registry).toContainText('The registry answered 401 Unauthorized.');
    await expect(registry).toContainText(
      'Reached, but the credentials were rejected. Check the user, password, token or mechanism.',
    );

    const connect = dialog.locator('li').filter({ hasText: 'http://connect:8083' });
    await expect(connect).toContainText('Connectivity · Unreachable');
    await expect(connect).toContainText(
      'The address could not be reached. Check host, port, DNS and firewall rules.',
    );

    expect(await results.count()).toBeGreaterThan(0);
  });

  test('shows the generated YAML fragment and the env vars it expects', async ({ page, api }) => {
    api.on('POST /system/connection-test', { json: data.connectionTestPartial });

    const dialog = await openTester(page);
    await dialog.getByLabel('Bootstrap servers').fill('broker-1:9092');
    await dialog.getByRole('button', { name: 'Run test' }).click();

    await expect(dialog.getByText('Generated configuration')).toBeVisible();
    const yaml = dialog.locator('pre').first();
    await expect(yaml).toContainText('clusters:');
    await expect(yaml).toContainText('bootstrapServers: broker-1:9092');
    await expect(yaml).toContainText('${KSHUI_LOCAL_SCHEMA_REGISTRY_PASSWORD}');

    await expect(
      dialog.getByText('Set these environment variables before starting k-shui'),
    ).toBeVisible();
    await expect(dialog.getByText(/export KSHUI_LOCAL_SCHEMA_REGISTRY_USERNAME=/)).toBeVisible();
  });

  test('an all-ok run reports every component reachable', async ({ page, api }) => {
    api.on('POST /system/connection-test', { json: data.connectionTestAllOk });

    const dialog = await openTester(page);
    await dialog.getByLabel('Bootstrap servers').fill('broker-1:9092');
    await dialog.getByRole('button', { name: 'Run test' }).click();

    await expect(dialog.getByText('All components reachable')).toBeVisible();
    await expect(dialog.getByText('Needs attention')).toHaveCount(0);
    const kafka = dialog.locator('li').filter({ hasText: 'broker-1:9092' });
    await expect(kafka).toContainText('OK');
    // No failure category is attached to a healthy component.
    await expect(kafka).not.toContainText(/Credentials|Connectivity|Permissions|Configuration/);
  });

  test('a required field blocks the request until it is filled', async ({ page, api }) => {
    const dialog = await openTester(page);

    await dialog.getByRole('button', { name: 'Run test' }).click();
    await expect(dialog.getByText('At least one host:port is required')).toBeVisible();
    expect(api.countOf('POST /system/connection-test')).toBe(0);

    await dialog.getByLabel('Bootstrap servers').fill('broker-1:9092');
    await dialog.getByRole('button', { name: 'Run test' }).click();
    await expect.poll(() => api.countOf('POST /system/connection-test')).toBe(1);
  });
});
