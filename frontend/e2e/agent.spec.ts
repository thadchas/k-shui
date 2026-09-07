import { test, expect } from './fixtures/test';
import { ADMIN_USER, CLUSTER_ID, GROUP_ORDERS } from './fixtures/data';
import type { AgentInvestigation, AgentOperation, AgentStatus } from '../src/api/agentTypes';

const status: AgentStatus = {
  enabled: true,
  actingUser: ADMIN_USER.username,
  effectiveModes: ['inspect', 'operate'],
  policy: {
    allowPayloads: false,
    maxToolCalls: 8,
    maxRunSeconds: 60,
    maxInputChars: 24000,
    maxOutputTokens: 2048,
    maxRunCostUsd: 0.25,
  },
  connections: [
    {
      id: 'test',
      name: 'Test provider',
      provider: 'openai',
      model: 'test-model',
      managed: true,
      credentialConfigured: true,
      state: 'connected',
      allowedClusters: [CLUSTER_ID],
    },
  ],
  unsupportedConnections: [],
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Agent panel fits ${viewport.width}px and returns keyboard focus on close`, async ({
    page,
    api,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    api.on('GET /agent/status', { json: status });
    api.on('GET /agent/investigations', { json: [] });
    await page.goto(`/c/${CLUSTER_ID}/overview`);
    const trigger = page.getByRole('button', { name: 'Ask K-Shui', exact: true });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'K-Shui Agent', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(`Cluster: ${CLUSTER_ID}`, { exact: true })).toBeVisible();
    const composer = panel.getByRole('textbox', { name: 'Ask K-Shui', exact: true });
    await expect(composer).toBeInViewport();
    await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    if (viewport.width >= 768) {
      const resize = panel.getByRole('separator', { name: 'Resize K-Shui Agent panel' });
      await resize.focus();
      await page.keyboard.press('Home');
      await expect(resize).toHaveAttribute('aria-valuenow', '380');
      await page.keyboard.press('ArrowLeft');
      await expect(resize).toHaveAttribute('aria-valuenow', '420');
    }
    await composer.focus();
    await testInfo.attach(`agent-panel-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(api.countOf('POST /agent/investigations')).toBe(0);
  });
}

function investigation(): AgentInvestigation {
  return {
    id: 'saved-agent',
    title: 'Consumer investigation',
    clusterId: CLUSTER_ID,
    resource: { type: 'consumer_group', name: GROUP_ORDERS },
    connectionId: 'test',
    provider: 'openai',
    model: 'test-model',
    mode: 'inspect',
    actingUser: ADMIN_USER.username,
    status: 'idle',
    messages: [],
    evidence: [],
    progress: [],
    operations: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test('contextual investigation retains the group, evidence and saved scope when expanded', async ({
  page,
  api,
}) => {
  let saved = investigation();
  api.on('GET /agent/status', { json: status });
  api.on('GET /agent/investigations', () => ({ json: [saved] }));
  api.on('POST /agent/investigations', (ctx) => {
    const input = JSON.parse(ctx.body ?? '{}');
    expect(input.clusterId).toBe(CLUSTER_ID);
    expect(input.resource).toEqual({ type: 'consumer_group', name: GROUP_ORDERS });
    saved = { ...saved, ...input };
    return { status: 201, json: saved };
  });
  api.on('GET /agent/investigations/:id', () => ({ json: saved }));
  api.on('POST /agent/investigations/:id/messages', (ctx) => {
    const input = JSON.parse(ctx.body ?? '{}');
    saved = {
      ...saved,
      status: 'succeeded',
      messages: [
        { id: 'user', role: 'user', content: input.content, createdAt: saved.createdAt },
        {
          id: 'answer',
          role: 'assistant',
          content: 'Pending records observed. The cause requires more evidence.',
          createdAt: saved.createdAt,
        },
      ],
      evidence: [
        {
          id: 'lag',
          clusterId: CLUSTER_ID,
          tool: 'get_group_lag',
          resource: { name: GROUP_ORDERS },
          href: `/c/${CLUSTER_ID}/consumers/${GROUP_ORDERS}`,
          observedAt: saved.createdAt,
          status: 'fresh',
          data: { lag: 42000 },
          limitations: ['Current snapshot only.'],
        },
      ],
    };
    return { status: 202, json: saved };
  });
  await page.goto(`/c/${CLUSTER_ID}/consumers/${GROUP_ORDERS}`);
  await page.getByRole('button', { name: 'Investigate', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'K-Shui Agent', exact: true });
  await expect(panel.getByRole('textbox', { name: 'Ask K-Shui', exact: true })).toHaveValue(
    'Why is this consumer group falling behind?',
  );
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    panel.getByText('Pending records observed. The cause requires more evidence.', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole('link', { name: GROUP_ORDERS, exact: true })).toHaveAttribute(
    'href',
    `/c/${CLUSTER_ID}/consumers/${GROUP_ORDERS}`,
  );
  await panel.getByRole('link', { name: 'Expand investigation' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${CLUSTER_ID}/agent\\?id=saved-agent$`));
  await expect(
    page.getByText('Pending records observed. The cause requires more evidence.', { exact: true }),
  ).toBeVisible();
  expect(api.countOf('POST /agent/investigations')).toBe(1);
});

test('operation preview cannot dispatch until typed confirmation and shows the verified result', async ({
  page,
  api,
}) => {
  const saved = { ...investigation(), mode: 'operate' as const, status: 'succeeded' };
  let operation: AgentOperation = {
    id: 'operation-1',
    investigationId: saved.id,
    clusterId: CLUSTER_ID,
    user: ADMIN_USER.username,
    action: 'group.offsets.reset',
    target: { name: GROUP_ORDERS },
    parameters: { strategy: 'earliest' },
    before: { offset: 100 },
    preview: { dryRun: true, offset: 0 },
    status: 'awaiting_confirmation',
    requiresConfirmation: true,
    confirmationText: GROUP_ORDERS,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    createdAt: saved.createdAt,
  };
  api.on('GET /agent/status', { json: status });
  api.on('GET /agent/investigations', { json: [saved] });
  api.on('GET /agent/investigations/:id', () => ({ json: { ...saved, operations: [operation] } }));
  api.on('POST /agent/investigations/:id/operations/:operationId/execute', (ctx) => {
    expect(JSON.parse(ctx.body ?? '{}')).toEqual({ confirmation: GROUP_ORDERS });
    operation = { ...operation, status: 'succeeded', after: { offset: 0, verified: true } };
    return { json: operation };
  });
  await page.goto(`/c/${CLUSTER_ID}/agent?id=${saved.id}`);
  const card = page.getByRole('article', { name: 'Operation group.offsets.reset' });
  const execute = card.getByRole('button', { name: 'Confirm and execute' });
  await expect(execute).toBeDisabled();
  expect(api.countOf('POST /agent/investigations/:id/operations/:operationId/execute')).toBe(0);
  await card.getByRole('textbox').fill('wrong-group');
  await expect(execute).toBeDisabled();
  await card.getByRole('textbox').fill(GROUP_ORDERS);
  await execute.click();
  await expect(card.getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(execute).toHaveCount(0);
  expect(api.countOf('POST /agent/investigations/:id/operations/:operationId/execute')).toBe(1);
});
