import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** Route table for the mocked API — each entry may resolve or reject. */
const responses = new Map<string, () => Promise<unknown>>();
const calls: string[] = [];

const get = vi.fn((path: string) => {
  calls.push(path);
  const handler = responses.get(path);
  return handler ? handler() : Promise.resolve([]);
});

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: { ...actual.api, get } };
});

const { CommandPalette } = await import('./CommandPalette');
const { useUiStore } = await import('@/stores/ui');

function renderPalette() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  useUiStore.setState({ commandOpen: true });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette clusterId="prod" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  get.mockClear();
  responses.clear();
  responses.set('/clusters', () => Promise.resolve([]));
  responses.set('/clusters/prod/topics', () =>
    Promise.resolve({
      items: [{ name: 'orders-v1', partitions: 3, replicationFactor: 2 }],
      page: 1,
      perPage: 8,
      total: 1,
    }),
  );
  responses.set('/clusters/prod/consumer-groups', () => Promise.resolve([]));
  responses.set('/clusters/prod/schemas/subjects', () =>
    Promise.resolve([{ subject: 'orders-value', latestVersion: 2, schemaType: 'AVRO' }]),
  );
  responses.set('/clusters/prod/flink', () => Promise.resolve([]));
  responses.set('/alerts/triggers', () => Promise.resolve([]));
  // Connect is down for every test below.
  responses.set('/clusters/prod/connect', () => Promise.reject(new Error('Connect unreachable')));
});

describe('CommandPalette resource search', () => {
  it('keeps reachable sources usable and offers a retry row for the failed one', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 'orders');

    expect(await screen.findByText('orders-v1', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('orders-value')).toBeInTheDocument();

    const retry = await screen.findByText('Connect unavailable — press to retry');
    expect(screen.getByText(/Partial results/)).toBeInTheDocument();

    const before = calls.filter((p) => p === '/clusters/prod/connect').length;
    await user.click(retry);
    expect(calls.filter((p) => p === '/clusters/prod/connect').length).toBeGreaterThan(before);
    // The retry did not navigate away or close the palette.
    expect(screen.getByText('orders-v1')).toBeInTheDocument();
  });

  it('narrows to a single source with a type prefix', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByRole('combobox'), 's: orders');

    expect(
      await screen.findByText('orders-value', undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('orders-v1')).not.toBeInTheDocument();
    // Connect was never queried, so its failure is not reported either.
    expect(calls).not.toContain('/clusters/prod/connect');
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
  });

  it('documents the prefix syntax before anything is typed', () => {
    renderPalette();
    expect(screen.getByText(/Narrow with a type prefix/)).toBeInTheDocument();
    expect(screen.getByText(/t: topics/)).toBeInTheDocument();
  });

  it('keeps the navigation commands available while searching', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole('combobox'), 'orders');
    expect(await screen.findByText('orders-v1', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });
});
