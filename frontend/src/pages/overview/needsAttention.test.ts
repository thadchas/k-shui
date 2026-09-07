import { describe, expect, it } from 'vitest';
import type { Connector, ConsumerGroupSummary, FlinkJob, UnhealthyPartition } from '@/api/types';
import {
  buildNeedsAttention,
  isAnySourceLoading,
  isFullyHealthy,
  LAG_CRITICAL_THRESHOLD,
  LAG_WARNING_THRESHOLD,
  type NeedsAttentionInput,
} from './needsAttention';

function partition(overrides: Partial<UnhealthyPartition> = {}): UnhealthyPartition {
  return {
    topic: 'orders',
    partition: 0,
    leader: 1,
    replicas: [1, 2, 3],
    isr: [1, 2, 3],
    reasons: ['offline'],
    ...overrides,
  };
}

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    name: 'sink-1',
    type: 'sink',
    connectorClass: 'io.debezium.Sink',
    state: 'RUNNING',
    workerId: 'worker-1',
    tasks: [],
    topics: [],
    config: {},
    ...overrides,
  };
}

function flinkJob(overrides: Partial<FlinkJob> = {}): FlinkJob {
  return {
    jid: 'jid-1',
    name: 'billing-job',
    state: 'RUNNING',
    startTime: 0,
    endTime: -1,
    duration: 1000,
    tasks: {
      total: 1,
      running: 1,
      finished: 0,
      canceling: 0,
      canceled: 0,
      failed: 0,
      created: 0,
      scheduled: 0,
      deploying: 0,
      reconciling: 0,
      initializing: 0,
    },
    ...overrides,
  };
}

function group(overrides: Partial<ConsumerGroupSummary> = {}): ConsumerGroupSummary {
  return {
    groupId: 'group-1',
    groupType: 'consumer',
    state: 'Stable',
    protocolType: null,
    protocol: null,
    coordinatorId: 1,
    memberCount: 2,
    topicCount: 1,
    partitionCount: 3,
    totalLag: 0,
    isSimple: false,
    ...overrides,
  };
}

const okEmpty: NeedsAttentionInput = {
  clusterId: 'prod',
  partitions: { status: 'ok', data: [] },
  connect: { status: 'ok', data: [] },
  flink: { status: 'ok', data: [] },
  lag: { status: 'ok', data: [] },
};

describe('buildNeedsAttention ranking order', () => {
  it('ranks offline/under-replicated partitions above failed services above sustained lag', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      partitions: { status: 'ok', data: [partition({ topic: 'orders', reasons: ['offline'] })] },
      connect: {
        status: 'ok',
        data: [{ kc: 'kc-1', connector: connector({ name: 'sink-1', state: 'FAILED' }) }],
      },
      lag: {
        status: 'ok',
        data: [
          {
            group: group({ groupId: 'group-1', totalLag: LAG_WARNING_THRESHOLD + 1 }),
            sustained: true,
          },
        ],
      },
    };
    const items = buildNeedsAttention(input);
    expect(items.map((i) => i.source)).toEqual(['partitions', 'connect', 'lag']);
    expect(items[0].tier).toBeLessThan(items[1].tier);
    expect(items[1].tier).toBeLessThan(items[2].tier);
  });

  it('ranks offline above under-replicated for the same topic', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      partitions: {
        status: 'ok',
        data: [
          partition({ topic: 'under-replicated-topic', reasons: ['underReplicated'] }),
          partition({ topic: 'offline-topic', reasons: ['offline'] }),
        ],
      },
    };
    const items = buildNeedsAttention(input);
    expect(items.map((i) => i.resource)).toEqual(['offline-topic', 'under-replicated-topic']);
    expect(items[0].severity).toBe('critical');
    expect(items[1].severity).toBe('warning');
  });

  it('excludes non-preferred-leader-only partitions from the queue', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      partitions: {
        status: 'ok',
        data: [partition({ topic: 'orders', reasons: ['nonPreferredLeader'] })],
      },
    };
    expect(buildNeedsAttention(input)).toHaveLength(0);
  });

  it('surfaces a failed connector task with its resource link and short error', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      connect: {
        status: 'ok',
        data: [
          {
            kc: 'kc-1',
            connector: connector({
              name: 'sink-1',
              state: 'RUNNING',
              tasks: [
                { id: 0, state: 'RUNNING', workerId: 'w1', trace: null },
                { id: 2, state: 'FAILED', workerId: 'w1', trace: 'boom: timeout\nat foo.bar' },
              ],
            }),
          },
        ],
      },
    };
    const [item] = buildNeedsAttention(input);
    expect(item.resource).toBe('sink-1');
    expect(item.evidence).toBe('task 2 FAILED: boom: timeout');
    expect(item.href).toBe('/c/prod/connect/kc-1/connectors/sink-1');
    expect(item.severity).toBe('critical');
  });

  it('surfaces a failed Flink job', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      flink: {
        status: 'ok',
        data: [{ fc: 'fc-1', job: flinkJob({ jid: 'jid-9', name: 'billing', state: 'FAILED' }) }],
      },
    };
    const [item] = buildNeedsAttention(input);
    expect(item.resource).toBe('billing');
    expect(item.evidence).toBe('job FAILED');
    expect(item.href).toBe('/c/prod/flink/fc-1/jobs/jid-9');
  });

  it('flags a single huge lag sample as critical even without sustained observation', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      lag: {
        status: 'ok',
        data: [
          {
            group: group({ groupId: 'group-x', totalLag: LAG_CRITICAL_THRESHOLD }),
            sustained: false,
          },
        ],
      },
    };
    const [item] = buildNeedsAttention(input);
    expect(item.severity).toBe('critical');
    expect(item.resource).toBe('group-x');
  });

  it('does not flag lag above the warning threshold unless sustained across polls', () => {
    const input: NeedsAttentionInput = {
      ...okEmpty,
      lag: {
        status: 'ok',
        data: [
          {
            group: group({ groupId: 'group-y', totalLag: LAG_WARNING_THRESHOLD + 1 }),
            sustained: false,
          },
        ],
      },
    };
    expect(buildNeedsAttention(input)).toHaveLength(0);
  });
});

describe('buildNeedsAttention empty/healthy state', () => {
  it('produces no items when every source loaded clean', () => {
    expect(buildNeedsAttention(okEmpty)).toHaveLength(0);
  });

  it('reports fully healthy only when all sources loaded and nothing needs attention', () => {
    const items = buildNeedsAttention(okEmpty);
    expect(isFullyHealthy(okEmpty, items)).toBe(true);
    expect(isAnySourceLoading(okEmpty)).toBe(false);
  });
});

describe('buildNeedsAttention unavailable sources', () => {
  it('never reports healthy when a source failed to load, even if others are clean', () => {
    const input: NeedsAttentionInput = { ...okEmpty, connect: { status: 'error' } };
    const items = buildNeedsAttention(input);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('unavailable');
    expect(items[0].href).toBeNull();
    expect(isFullyHealthy(input, items)).toBe(false);
  });

  it('emits one unavailable row per failed source, independent of the others', () => {
    const input: NeedsAttentionInput = {
      clusterId: 'prod',
      partitions: { status: 'error' },
      connect: { status: 'ok', data: [] },
      flink: { status: 'error' },
      lag: { status: 'ok', data: [] },
    };
    const items = buildNeedsAttention(input);
    expect(items.map((i) => i.source)).toEqual(['partitions', 'flink']);
    expect(items.every((i) => i.severity === 'unavailable')).toBe(true);
  });

  it('treats a still-loading source as neither healthy nor an item', () => {
    const input: NeedsAttentionInput = { ...okEmpty, lag: { status: 'loading' } };
    expect(buildNeedsAttention(input)).toHaveLength(0);
    expect(isAnySourceLoading(input)).toBe(true);
    expect(isFullyHealthy(input, buildNeedsAttention(input))).toBe(false);
  });
});
