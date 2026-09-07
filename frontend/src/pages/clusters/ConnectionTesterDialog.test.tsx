import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionTestResponse } from '@/api/types';
import { TooltipProvider } from '@/components/ui/tooltip';

const runTest = vi.fn();
const generate = vi.fn();

vi.mock('@/api/hooks/system', () => ({
  useConnectionTest: () => ({ mutateAsync: runTest, isPending: false }),
  useConnectionConfig: () => ({ mutateAsync: generate, isPending: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  REQUIRES_EDITOR: 'Requires editor role',
  usePermissions: () => ({ role: 'admin', canEdit: true, isAdmin: true, loading: false }),
}));

import { ConnectionTesterDialog } from './ConnectionTesterDialog';

const response = (overrides: Partial<ConnectionTestResponse> = {}): ConnectionTestResponse => ({
  ok: false,
  clusterId: 'local',
  durationMs: 42,
  components: [
    {
      component: 'kafka',
      label: 'Kafka',
      target: 'broker-1:9092',
      status: 'ok',
      category: 'none',
      latencyMs: 12,
      detail: 'Connected to 3 broker(s).',
      metadata: { brokerCount: 3, clusterId: 'abc' },
    },
    {
      component: 'schemaRegistry',
      label: 'Schema Registry',
      target: 'http://sr:8081',
      status: 'auth_failed',
      category: 'credentials',
      latencyMs: 8,
      detail: 'Schema Registry rejected the credentials (HTTP 401).',
      metadata: {},
    },
  ],
  config: { yaml: 'clusters:\n  - id: local\n', envVars: [] },
  ...overrides,
});

function renderDialog() {
  return render(
    <TooltipProvider>
      <ConnectionTesterDialog open onOpenChange={() => {}} />
    </TooltipProvider>,
  );
}

describe('ConnectionTesterDialog', () => {
  beforeEach(() => {
    runTest.mockReset();
    generate.mockReset();
  });

  it('explains that the config is deployment-managed', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Test a connection' })).toBeInTheDocument();
    expect(screen.getByText(/reads its cluster list at startup/i)).toBeInTheDocument();
  });

  it('refuses to submit without bootstrap servers', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /run test/i }));
    expect(await screen.findByText(/at least one host:port is required/i)).toBeInTheDocument();
    expect(runTest).not.toHaveBeenCalled();
  });

  it('sends the typed details and shows a per-component verdict', async () => {
    const user = userEvent.setup();
    runTest.mockResolvedValue(response());
    renderDialog();

    await user.type(screen.getByLabelText(/bootstrap servers/i), 'broker-1:9092');
    await user.type(screen.getByLabelText(/schema registry url/i), 'http://sr:8081');
    await user.click(screen.getByRole('button', { name: /run test/i }));

    await waitFor(() => expect(runTest).toHaveBeenCalledTimes(1));
    expect(runTest).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'local',
        bootstrapServers: 'broker-1:9092',
        schemaRegistry: expect.objectContaining({ url: 'http://sr:8081', type: 'confluent' }),
      }),
    );

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Kafka')).toBeInTheDocument();
    // the failure names its category, not just "failed"
    expect(screen.getByText(/Credentials · Auth failed/)).toBeInTheDocument();
    expect(screen.getByText(/Check the user, password, token or mechanism/)).toBeInTheDocument();
    expect(screen.getByText('brokers 3 · cluster abc')).toBeInTheDocument();
  });

  it('renders the generated YAML with the restart instruction', async () => {
    const user = userEvent.setup();
    runTest.mockResolvedValue(
      response({
        ok: true,
        config: {
          yaml: 'clusters:\n  - id: local\n    bootstrapServers: broker-1:9092\n',
          envVars: [
            {
              name: 'KSHUI_LOCAL_SASL_PASSWORD',
              component: 'kafka',
              description: 'Kafka client property sasl.password.',
            },
          ],
        },
      }),
    );
    renderDialog();

    await user.type(screen.getByLabelText(/bootstrap servers/i), 'broker-1:9092');
    await user.click(screen.getByRole('button', { name: /run test/i }));

    expect(await screen.findByText(/bootstrapServers: broker-1:9092/)).toBeInTheDocument();
    expect(screen.getByText(/export KSHUI_LOCAL_SASL_PASSWORD/)).toBeInTheDocument();
    expect(screen.getByText(/restart k-shui/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });

  it('can generate the config without running a test', async () => {
    const user = userEvent.setup();
    generate.mockResolvedValue({ yaml: 'clusters:\n  - id: local\n', envVars: [] });
    renderDialog();

    await user.type(screen.getByLabelText(/bootstrap servers/i), 'broker-1:9092');
    await user.click(screen.getByRole('button', { name: /generate config only/i }));

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(runTest).not.toHaveBeenCalled();
    expect(await screen.findByText(/id: local/)).toBeInTheDocument();
  });
});
