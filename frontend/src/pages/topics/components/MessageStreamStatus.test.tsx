import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageStreamStatus } from './MessageStreamStatus';
import { consumptionStatus, type ConsumptionInput } from './messageSearch';

const renderStatus = (input: ConsumptionInput, live = false) =>
  render(
    <MessageStreamStatus
      status={consumptionStatus(input)}
      behind={0}
      pendingCount={3}
      shown={12}
      scanned={40}
      matched={12}
      limit={100}
      estimatedTotal={100}
      progressPct={40}
      live={live}
    />,
  );

const base: ConsumptionInput = {
  hasRun: true,
  streaming: false,
  live: false,
  paused: false,
  done: false,
};

describe('MessageStreamStatus', () => {
  it('spells out the live state instead of relying on an icon', () => {
    renderStatus({ ...base, streaming: true, live: true }, true);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Streaming new records')).toBeInTheDocument();
  });

  it('spells out the paused state and how much is buffered', () => {
    renderStatus({ ...base, streaming: true, live: true, paused: true }, true);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('3 new while paused')).toBeInTheDocument();
  });

  it('spells out the stopped state after a finished query', () => {
    renderStatus({ ...base, done: true });
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Query finished — results held')).toBeInTheDocument();
  });

  it('shows an idle state with no counters before the first run', () => {
    renderStatus({ ...base, hasRun: false });
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('No query running')).toBeInTheDocument();
    expect(screen.queryByText(/shown/)).not.toBeInTheDocument();
  });
});
