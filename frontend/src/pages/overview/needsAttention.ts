import { formatCompact } from '@/lib/format';
import type { Connector, ConsumerGroupSummary, FlinkJob, UnhealthyPartition } from '@/api/types';

/**
 * Pure ranking/derivation logic for the "Needs attention" queue on the cluster
 * overview page. Kept free of React/React Query so it can be unit tested in
 * isolation (see needsAttention.test.ts) and so the page component only has to
 * wire live query state into `NeedsAttentionInput`.
 */

export type AttentionSourceId = 'partitions' | 'connect' | 'flink' | 'lag';
export type AttentionSeverity = 'critical' | 'warning' | 'unavailable';

export interface AttentionItem {
  /** Stable key for React lists. */
  id: string;
  source: AttentionSourceId;
  /** 0 = offline/under-replicated partitions, 1 = failed services, 2 = sustained lag. */
  tier: 0 | 1 | 2;
  severity: AttentionSeverity;
  /** Human name of the affected resource (topic, connector, job, consumer group). */
  resource: string;
  /** One-line evidence, e.g. "3 offline partitions" or "task 2 FAILED: timeout". */
  evidence: string;
  /** Link to the exact resource page, preserving the cluster id. `null` for unavailable rows. */
  href: string | null;
  /** Used to break ties within the same tier/severity — higher sorts first. */
  magnitude: number;
}

/** Normalized state of one telemetry source feeding the queue. */
export interface SourceState<T> {
  status: 'loading' | 'error' | 'ok';
  data?: T;
}

export interface ConnectorWithCluster {
  kc: string;
  connector: Connector;
}

export interface FlinkJobWithCluster {
  fc: string;
  job: FlinkJob;
}

export interface LagCandidate {
  group: ConsumerGroupSummary;
  /** True once the group has been observed above the warning threshold on 2+ consecutive polls. */
  sustained: boolean;
}

export interface NeedsAttentionInput {
  clusterId: string;
  partitions: SourceState<UnhealthyPartition[]>;
  connect: SourceState<ConnectorWithCluster[]>;
  flink: SourceState<FlinkJobWithCluster[]>;
  lag: SourceState<LagCandidate[]>;
}

/** Any single sample at/above this magnitude is flagged regardless of persistence. */
export const LAG_CRITICAL_THRESHOLD = 1_000_000;
/** Below this, a group is never flagged, however long it persists. */
export const LAG_WARNING_THRESHOLD = 10_000;
/** Consecutive polls above `LAG_WARNING_THRESHOLD` required before lag counts as "sustained". */
export const LAG_SUSTAINED_POLLS = 2;

const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = {
  critical: 0,
  unavailable: 1,
  warning: 2,
};

function topicHref(clusterId: string, topic: string): string {
  return `/c/${encodeURIComponent(clusterId)}/topics/${encodeURIComponent(topic)}?tab=partitions`;
}

function connectorHref(clusterId: string, kc: string, name: string): string {
  return `/c/${encodeURIComponent(clusterId)}/connect/${encodeURIComponent(kc)}/connectors/${encodeURIComponent(name)}`;
}

function flinkJobHref(clusterId: string, fc: string, jid: string): string {
  return `/c/${encodeURIComponent(clusterId)}/flink/${encodeURIComponent(fc)}/jobs/${encodeURIComponent(jid)}`;
}

function groupHref(clusterId: string, groupId: string): string {
  return `/c/${encodeURIComponent(clusterId)}/consumers/${encodeURIComponent(groupId)}`;
}

/** First non-empty line of a stack trace, truncated for a one-line evidence string. */
function shortError(trace: string | null | undefined, max = 90): string | null {
  if (!trace) return null;
  const firstLine = trace
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

function unavailableItem(
  source: AttentionSourceId,
  tier: 0 | 1 | 2,
  resource: string,
  evidence: string,
): AttentionItem {
  return {
    id: `unavailable:${source}`,
    source,
    tier,
    severity: 'unavailable',
    resource,
    evidence,
    href: null,
    magnitude: Number.POSITIVE_INFINITY,
  };
}

function buildPartitionItems(
  clusterId: string,
  state: SourceState<UnhealthyPartition[]>,
): AttentionItem[] {
  if (state.status === 'error') {
    return [
      unavailableItem(
        'partitions',
        0,
        'Partition health',
        'Partition telemetry failed to load — offline or under-replicated partitions may be hidden.',
      ),
    ];
  }
  if (state.status !== 'ok') return [];

  const byTopic = new Map<string, { offline: number; underReplicated: number }>();
  for (const p of state.data ?? []) {
    const isOffline = p.reasons.includes('offline');
    const isUrp = p.reasons.includes('underReplicated');
    if (!isOffline && !isUrp) continue;
    const entry = byTopic.get(p.topic) ?? { offline: 0, underReplicated: 0 };
    if (isOffline) entry.offline += 1;
    if (isUrp) entry.underReplicated += 1;
    byTopic.set(p.topic, entry);
  }

  const items: AttentionItem[] = [];
  for (const [topic, counts] of byTopic) {
    const severity: AttentionSeverity = counts.offline > 0 ? 'critical' : 'warning';
    const parts: string[] = [];
    if (counts.offline > 0)
      parts.push(`${counts.offline} offline partition${counts.offline === 1 ? '' : 's'}`);
    if (counts.underReplicated > 0) {
      parts.push(
        `${counts.underReplicated} under-replicated partition${counts.underReplicated === 1 ? '' : 's'}`,
      );
    }
    items.push({
      id: `partitions:${topic}`,
      source: 'partitions',
      tier: 0,
      severity,
      resource: topic,
      evidence: parts.join(', '),
      href: topicHref(clusterId, topic),
      magnitude: counts.offline * 1000 + counts.underReplicated,
    });
  }
  return items;
}

function buildConnectItems(
  clusterId: string,
  state: SourceState<ConnectorWithCluster[]>,
): AttentionItem[] {
  if (state.status === 'error') {
    return [
      unavailableItem(
        'connect',
        1,
        'Kafka Connect',
        'Connect telemetry failed to load — failed connectors or tasks may be hidden.',
      ),
    ];
  }
  if (state.status !== 'ok') return [];

  const items: AttentionItem[] = [];
  for (const { kc, connector } of state.data ?? []) {
    const failedTasks = connector.tasks.filter((t) => t.state === 'FAILED');
    if (connector.state === 'FAILED') {
      const detail = shortError(connector.trace);
      items.push({
        id: `connect:${kc}:${connector.name}`,
        source: 'connect',
        tier: 1,
        severity: 'critical',
        resource: connector.name,
        evidence: detail ? `connector FAILED: ${detail}` : 'connector FAILED',
        href: connectorHref(clusterId, kc, connector.name),
        magnitude: 1000 + failedTasks.length,
      });
    } else if (failedTasks.length > 0) {
      const worst = failedTasks[0];
      const detail = shortError(worst.trace);
      const suffix = failedTasks.length > 1 ? ` (+${failedTasks.length - 1} more)` : '';
      items.push({
        id: `connect:${kc}:${connector.name}`,
        source: 'connect',
        tier: 1,
        severity: 'critical',
        resource: connector.name,
        evidence: detail
          ? `task ${worst.id} FAILED: ${detail}${suffix}`
          : `task ${worst.id} FAILED${suffix}`,
        href: connectorHref(clusterId, kc, connector.name),
        magnitude: failedTasks.length,
      });
    }
  }
  return items;
}

function buildFlinkItems(
  clusterId: string,
  state: SourceState<FlinkJobWithCluster[]>,
): AttentionItem[] {
  if (state.status === 'error') {
    return [
      unavailableItem(
        'flink',
        1,
        'Flink',
        'Flink telemetry failed to load — failed jobs may be hidden.',
      ),
    ];
  }
  if (state.status !== 'ok') return [];

  const items: AttentionItem[] = [];
  for (const { fc, job } of state.data ?? []) {
    if ((job.state ?? '').toUpperCase() !== 'FAILED') continue;
    items.push({
      id: `flink:${fc}:${job.jid}`,
      source: 'flink',
      tier: 1,
      severity: 'critical',
      resource: job.name || job.jid,
      evidence: 'job FAILED',
      href: flinkJobHref(clusterId, fc, job.jid),
      magnitude: 1,
    });
  }
  return items;
}

function buildLagItems(clusterId: string, state: SourceState<LagCandidate[]>): AttentionItem[] {
  if (state.status === 'error') {
    return [
      unavailableItem(
        'lag',
        2,
        'Consumer lag',
        'Consumer group telemetry failed to load — growing lag may be hidden.',
      ),
    ];
  }
  if (state.status !== 'ok') return [];

  const items: AttentionItem[] = [];
  for (const { group, sustained } of state.data ?? []) {
    const lag = group.totalLag;
    if (lag >= LAG_CRITICAL_THRESHOLD) {
      items.push({
        id: `lag:${group.groupId}`,
        source: 'lag',
        tier: 2,
        severity: 'critical',
        resource: group.groupId,
        evidence: `lag ${formatCompact(lag)}`,
        href: groupHref(clusterId, group.groupId),
        magnitude: lag,
      } satisfies AttentionItem);
    } else if (sustained && lag >= LAG_WARNING_THRESHOLD) {
      items.push({
        id: `lag:${group.groupId}`,
        source: 'lag',
        tier: 2,
        severity: 'warning',
        resource: group.groupId,
        evidence: `sustained lag ${formatCompact(lag)}`,
        href: groupHref(clusterId, group.groupId),
        magnitude: lag,
      } satisfies AttentionItem);
    }
  }
  return items;
}

/** Rank the queue: tier asc, then severity (critical, unavailable, warning), then magnitude desc. */
function sortItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (SEVERITY_WEIGHT[a.severity] !== SEVERITY_WEIGHT[b.severity]) {
      return SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    }
    if (a.magnitude !== b.magnitude) return b.magnitude - a.magnitude;
    return a.resource.localeCompare(b.resource);
  });
}

/** Build the ranked "Needs attention" queue from normalized source states. */
export function buildNeedsAttention(input: NeedsAttentionInput): AttentionItem[] {
  return sortItems([
    ...buildPartitionItems(input.clusterId, input.partitions),
    ...buildConnectItems(input.clusterId, input.connect),
    ...buildFlinkItems(input.clusterId, input.flink),
    ...buildLagItems(input.clusterId, input.lag),
  ]);
}

/** True while any source has not yet resolved (loading and no cached data to render). */
export function isAnySourceLoading(input: NeedsAttentionInput): boolean {
  return [input.partitions, input.connect, input.flink, input.lag].some(
    (s) => s.status === 'loading',
  );
}

/**
 * Everything that could be checked was checked, and nothing needs attention.
 * Never true when a source errored or is still loading — missing telemetry
 * must never be reported as an all-clear.
 */
export function isFullyHealthy(input: NeedsAttentionInput, items: AttentionItem[]): boolean {
  const allLoaded = [input.partitions, input.connect, input.flink, input.lag].every(
    (s) => s.status === 'ok',
  );
  return allLoaded && items.length === 0;
}
