import { describe, expect, it } from 'vitest';
import type { ConsumerGroupMember, ConsumerGroupPartition, SeriesPoint } from '@/api/types';
import {
  computeAssignmentSkew,
  deriveProcessingHealth,
  findWorstPartition,
  formatTimeLag,
  PROCESSING_HEALTH_LABEL,
  TIME_LAG_WARN_MS,
} from './lag';

describe('formatTimeLag', () => {
  it('never renders a missing estimate as caught up', () => {
    expect(formatTimeLag(null)).toBe('—');
    expect(formatTimeLag(undefined)).toBe('—');
    expect(formatTimeLag(Number.NaN)).toBe('—');
  });
  it('formats small and large values', () => {
    expect(formatTimeLag(0)).toBe('0s');
    expect(formatTimeLag(400)).toBe('<1s');
    expect(formatTimeLag(90_000)).toMatch(/1m/);
  });
  it('warn threshold is five minutes', () => {
    expect(TIME_LAG_WARN_MS).toBe(300_000);
  });
});

function partition(topic: string, partitionId: number, lag: number | null): ConsumerGroupPartition {
  return {
    topic,
    partition: partitionId,
    currentOffset: 0,
    endOffset: 0,
    lag,
    memberId: null,
    clientId: null,
    host: null,
  };
}

function member(memberId: string, partitionCount: number): ConsumerGroupMember {
  return {
    memberId,
    clientId: memberId,
    host: 'host',
    assignments: Array.from({ length: partitionCount }, (_, i) => ({ topic: 't', partition: i })),
  };
}

describe('findWorstPartition', () => {
  it('picks the partition with the highest known lag', () => {
    const result = findWorstPartition([
      partition('orders', 0, 10),
      partition('orders', 1, 500),
      partition('payments', 0, 250),
    ]);
    expect(result).toEqual({ topic: 'orders', partition: 1, lag: 500 });
  });

  it('excludes unknown (null) lag from the comparison, never treating it as a min or max', () => {
    const result = findWorstPartition([partition('orders', 0, null), partition('orders', 1, 5)]);
    expect(result).toEqual({ topic: 'orders', partition: 1, lag: 5 });
  });

  it('returns null when every partition has unknown lag', () => {
    expect(findWorstPartition([partition('orders', 0, null)])).toBeNull();
  });

  it('returns null for an empty or missing partition list', () => {
    expect(findWorstPartition([])).toBeNull();
    expect(findWorstPartition(undefined)).toBeNull();
  });
});

describe('computeAssignmentSkew', () => {
  it('computes the busiest-vs-idlest ratio across members', () => {
    const skew = computeAssignmentSkew([member('a', 8), member('b', 2)]);
    expect(skew).toEqual({ memberCount: 2, minPartitions: 2, maxPartitions: 8, ratio: 4 });
  });

  it('is null for a single member — nothing to compare skew against', () => {
    const skew = computeAssignmentSkew([member('solo', 6)]);
    expect(skew.memberCount).toBe(1);
    expect(skew.ratio).toBeNull();
  });

  it('is null when zero partitions are assigned (avoids dividing by zero)', () => {
    const skew = computeAssignmentSkew([member('a', 0), member('b', 0)]);
    expect(skew.minPartitions).toBe(0);
    expect(skew.maxPartitions).toBe(0);
    expect(skew.ratio).toBeNull();
  });

  it('is null for a group with no members', () => {
    expect(computeAssignmentSkew([])).toEqual({
      memberCount: 0,
      minPartitions: 0,
      maxPartitions: 0,
      ratio: null,
    });
    expect(computeAssignmentSkew(undefined).ratio).toBeNull();
  });
});

describe('deriveProcessingHealth', () => {
  it('is caught-up when the known total lag is zero', () => {
    expect(deriveProcessingHealth({ totalLag: 0 })).toBe('caught-up');
  });

  it('is falling-behind for a sustained lag increase, even without a totalLag figure', () => {
    const growing: SeriesPoint[] = [
      [1, 10],
      [2, 40],
      [3, 90],
      [4, 150],
      [5, 220],
    ];
    expect(deriveProcessingHealth({ totalLag: undefined, points: growing })).toBe('falling-behind');
    // and when totalLag is reported directly alongside the growing history
    expect(deriveProcessingHealth({ totalLag: 220, points: growing })).toBe('falling-behind');
  });

  it('is unknown when there is no total lag and no history to fall back on', () => {
    expect(deriveProcessingHealth({ totalLag: null })).toBe('unknown');
    expect(deriveProcessingHealth({ totalLag: undefined, points: [] })).toBe('unknown');
    expect(deriveProcessingHealth({ totalLag: Number.NaN })).toBe('unknown');
  });

  it('never reports missing data as caught-up (healthy)', () => {
    const result = deriveProcessingHealth({ totalLag: undefined, points: undefined });
    expect(result).not.toBe('caught-up');
    expect(result).toBe('unknown');
  });

  it('exposes a human label for every state', () => {
    expect(PROCESSING_HEALTH_LABEL['caught-up']).toBe('Caught up');
    expect(PROCESSING_HEALTH_LABEL['falling-behind']).toBe('Falling behind');
    expect(PROCESSING_HEALTH_LABEL.unknown).toBe('No data');
  });
});
