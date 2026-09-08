import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { AgentInvestigation, AgentOperation } from '@/api/agentTypes';
import { useAgentStore } from '@/stores/agent';
import { AgentWorkspace } from './AgentWorkspace';
import { AgentPanel, AskKShuiButton } from './AgentPanel';
import { EvidenceCard } from './EvidenceCard';
import { OperationCard } from './OperationCard';
import { agentStarters } from './agentStarters';
import { EvidenceReferences } from './EvidenceReferences';
import { operationCanExecute, safeEvidenceHref } from './agentUtils';

const mocks = vi.hoisted(() => ({
  detail: undefined as AgentInvestigation | undefined,
  execute: vi.fn(),
  send: vi.fn(),
  create: vi.fn(),
  refetch: vi.fn(),
  cancelOperation: vi.fn(),
  reprepare: vi.fn(),
  refreshEvidence: vi.fn(),
}));
vi.mock('@/api/hooks/system', () => ({
  useInfo: () => ({
    data: {
      clusters: [
        { id: 'a', name: 'Cluster A' },
        { id: 'b', name: 'Cluster B' },
      ],
    },
  }),
}));
vi.mock('@/api/hooks/agent', () => ({
  useAgentStatus: () => ({
    data: {
      enabled: true,
      actingUser: 'alice',
      effectiveModes: ['inspect'],
      connections: [
        { id: 'api', name: 'Team API', provider: 'openai', model: 'test', allowedClusters: [] },
      ],
      policy: { maxInputChars: 1000, maxRunCostUsd: 1 },
    },
  }),
  useInvestigation: () => ({ data: mocks.detail, refetch: mocks.refetch }),
  useInvestigations: () => ({ data: [] }),
  useAgentActions: () => ({
    create: { mutateAsync: mocks.create, reset: vi.fn() },
    send: { mutateAsync: mocks.send, reset: vi.fn() },
    cancel: { reset: vi.fn() },
    execute: { mutate: mocks.execute },
    cancelOperation: { mutate: mocks.cancelOperation },
    reprepare: { mutate: mocks.reprepare },
    refreshEvidence: { mutate: mocks.refreshEvidence },
  }),
}));
const operation = (overrides: Partial<AgentOperation> = {}): AgentOperation => ({
  id: 'op',
  investigationId: 'inv',
  clusterId: 'a',
  user: 'alice',
  action: 'topic.delete',
  target: { name: 'orders' },
  parameters: {},
  before: {},
  preview: { effect: 'Permanently delete orders' },
  status: 'awaiting_confirmation',
  requiresConfirmation: true,
  confirmationText: 'delete orders',
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-09-07T00:00:00Z',
  ...overrides,
});
const mount = (node = <AgentWorkspace />) => render(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail = undefined;
  useAgentStore.setState({
    owner: 'alice',
    open: true,
    context: { clusterId: 'a' },
    investigationId: null,
    draft: '',
  });
});

describe('scoped investigations', () => {
  it('prefills the contextual question as an editable draft without sending', () => {
    useAgentStore.getState().openPanel({
      clusterId: 'a',
      resource: { type: 'consumer_group', name: 'billing' },
      prompt: 'Why is billing falling behind?',
    });
    mount();
    expect(screen.getByLabelText('Ask K-Shui')).toHaveValue('Why is billing falling behind?');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('discards resource and time context when switching clusters', async () => {
    useAgentStore.getState().setContext({
      clusterId: 'a',
      resource: { type: 'topic', name: 'orders' },
      timeWindow: { start: '2026-01-01' },
    });
    mount();
    await userEvent.selectOptions(screen.getByLabelText('Investigation cluster'), 'b');
    expect(useAgentStore.getState().context).toEqual({ clusterId: 'b' });
    expect(screen.queryByText('topic: orders')).not.toBeInTheDocument();
  });
  it('removing a resource begins a new investigation and retains original saved evidence', async () => {
    useAgentStore.setState({ investigationId: 'inv' });
    mocks.detail = {
      id: 'inv',
      clusterId: 'a',
      resource: { type: 'topic', name: 'orders' },
      mode: 'inspect',
      actingUser: 'alice',
      status: 'succeeded',
      provider: 'openai',
      model: 'test',
      messages: [],
      evidence: [],
      progress: [],
      updatedAt: '2026-09-07',
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    } as unknown as AgentInvestigation;
    mount();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove resource and start a new investigation' }),
    );
    expect(useAgentStore.getState().investigationId).toBeNull();
    expect(useAgentStore.getState().context.resource).toBeUndefined();
    expect(mocks.detail.resource?.name).toBe('orders');
  });
  it('does not offer Operate to a viewer', () => {
    mount();
    expect(screen.getByRole('option', { name: 'Operate — unavailable' })).toBeDisabled();
  });
  it('clears context, draft and investigation when the authenticated identity changes', () => {
    useAgentStore.setState({
      investigationId: 'private',
      draft: 'private text',
      context: { clusterId: 'private-cluster' },
    });
    useAgentStore.getState().bindIdentity('bob');
    expect(useAgentStore.getState()).toMatchObject({
      owner: 'bob',
      investigationId: null,
      draft: '',
      context: {},
      open: false,
    });
  });
});

describe('operation confirmation and evidence', () => {
  it('requires the exact target before dispatching a consequential operation', async () => {
    mount(<OperationCard operation={operation()} canOperate />);
    const execute = screen.getByRole('button', { name: 'Confirm and execute' });
    expect(execute).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'ORDERS');
    expect(execute).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'orders');
    expect(execute).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'delete orders');
    await userEvent.click(execute);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      id: 'inv',
      operationId: 'op',
      confirmation: 'delete orders',
    });
  });
  it('blocks expired, uncertain, failed and already successful operation replays', () => {
    for (const status of ['outcome_unknown', 'failed', 'succeeded', 'running', 'cancelled'])
      expect(operationCanExecute(operation({ status }), 'orders')).toBe(false);
    expect(operationCanExecute(operation({ expiresAt: '2000-01-01' }), 'orders')).toBe(false);
    expect(operationCanExecute(operation({ confirmationText: undefined }), 'orders')).toBe(false);
  });
  it('blocks execution when current user cannot operate', () => {
    mount(
      <OperationCard
        operation={operation({ requiresConfirmation: false, status: 'prepared' })}
        canOperate={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Execute prepared change' })).toBeDisabled();
  });
  it('renders object resource evidence with its original cluster, timestamp, and missing data', () => {
    mount(
      <EvidenceCard
        evidence={{
          id: 'e',
          clusterId: 'a',
          tool: 'get_group_lag',
          resource: { name: 'billing' },
          href: '/c/a/consumers/billing',
          observedAt: '2026-09-07T10:00:00Z',
          status: 'partial',
          data: { lag: 42 },
          limitations: ['Historical rates unavailable'],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'billing' })).toHaveAttribute(
      'href',
      '/c/a/consumers/billing',
    );
    expect(screen.getByText('Historical rates unavailable')).toBeInTheDocument();
    expect(screen.getByText('Observed evidence')).toBeInTheDocument();
  });
  it('rejects external, protocol-relative and executable evidence links', () => {
    for (const href of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      '/c/\\evil',
      '/login',
    ])
      expect(safeEvidenceHref(href)).toBeNull();
    expect(safeEvidenceHref('/c/a/topics/orders')).toBe('/c/a/topics/orders');
  });
});

describe('agent panel keyboard access', () => {
  it('opens from the topbar, resizes with keyboard, and restores focus on close', async () => {
    useAgentStore.setState({ open: false, width: 560 });
    mount(
      <>
        <AskKShuiButton clusterId="a" />
        <AgentPanel />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Ask K-Shui' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const resize = screen.getByRole('separator', { name: 'Resize K-Shui Agent panel' });
    resize.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(resize).toHaveAttribute('aria-valuenow', '600');
    await userEvent.click(screen.getByRole('button', { name: 'Close K-Shui Agent' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const observed = {
  id: 'source',
  clusterId: 'a',
  tool: 'get_group_lag',
  resource: { name: 'orders' },
  href: '/c/a/consumers/orders',
  observedAt: '2000-01-01T00:00:00Z',
  status: 'fresh',
  data: { lag: 10 },
  limitations: [],
};

it('withdraws a prepared change even when operation authority is no longer available', async () => {
  const view = mount(<OperationCard operation={operation()} canOperate={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel prepared change' }));
  expect(mocks.cancelOperation).toHaveBeenCalledWith({ id: 'inv', operationId: 'op' });
  view.rerender(
    <MemoryRouter>
      <OperationCard operation={operation({ status: 'cancelled' })} canOperate />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: 'Confirm and execute' })).not.toBeInTheDocument();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('expires an idle preview and offers an explicit new preview without executing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const op = operation({ expiresAt: '2026-01-01T00:00:02Z', requiresConfirmation: false });
  mount(<OperationCard operation={op} canOperate />);
  expect(screen.getByRole('button', { name: 'Execute prepared change' })).toBeEnabled();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button', { name: 'Preview expired' })).toBeDisabled();
  act(() => screen.getByRole('button', { name: 'Prepare new preview' }).click());
  expect(mocks.reprepare).toHaveBeenCalledWith(op);
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('separates historical age from successful retrieval and refreshes the exact saved source', async () => {
  mount(<EvidenceCard evidence={observed} investigationId="inv" />);
  expect(screen.getByText('Historical snapshot')).toBeInTheDocument();
  expect(screen.getByText('Retrieval: Successful')).toBeInTheDocument();
  expect(document.querySelector('time')).toHaveAttribute('dateTime', observed.observedAt);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh evidence' }));
  expect(mocks.refreshEvidence).toHaveBeenCalledWith({ id: 'inv', evidenceId: 'source' });
});

it('ages a recent snapshot while idle', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  mount(<EvidenceCard evidence={{ ...observed, observedAt: new Date().toISOString() }} />);
  expect(screen.getByText('Recent snapshot')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(120000));
  expect(screen.getByText('Historical snapshot')).toBeInTheDocument();
});

it('opens the precise cited observation and refuses unvalidated references', async () => {
  const scroll = vi.fn();
  mount(
    <>
      <EvidenceReferences
        content="Claim [evidence:source] [evidence:invented]"
        evidenceIds={['source']}
        evidence={[observed]}
      />
      <EvidenceCard evidence={observed} />
    </>,
  );
  const card = screen.getByRole('article', { name: 'Evidence source' });
  card.scrollIntoView = scroll;
  await userEvent.click(screen.getByRole('button', { name: /Evidence ·/ }));
  expect(card).toHaveFocus();
  expect(card.querySelector('details')).toHaveAttribute('open');
  expect(scroll).toHaveBeenCalled();
  expect(screen.getByText('[Source unavailable]')).toBeInTheDocument();
});

it('limits starters by selected resource, mode, and allowed evidence tools', () => {
  const group = { type: 'consumer_group', name: 'orders' };
  const inspect = agentStarters(group, 'inspect', ['get_group_lag']);
  expect(inspect).toHaveLength(1);
  expect(inspect[0]).toContain('growing or draining');
  expect(agentStarters(group, 'inspect', [])).toEqual([]);
  expect(agentStarters(undefined, 'inspect', ['get_group_lag'])).toEqual([]);
  expect(agentStarters(group, 'operate', ['get_group_lag']).join(' ')).toContain('offset reset');
  const schema = agentStarters({ type: 'schema', name: 'orders' }, 'inspect', [
    'get_schema_summary',
  ]);
  expect(schema.join(' ')).toContain('check a candidate schema');
  expect(schema.join(' ')).not.toContain('Explain this schema compatibility error');
});
