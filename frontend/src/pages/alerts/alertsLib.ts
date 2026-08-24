import {
  Boxes,
  Cable,
  Database,
  FileCode2,
  Layers,
  Mail,
  MessageSquare,
  Server,
  Siren,
  SlidersHorizontal,
  Users,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { ApiError } from '@/api/client';
import type {
  AlertActionType,
  AlertComponent,
  AlertCondition,
  AlertMetricCatalog,
  AlertSeverity,
} from '@/api/types';
import type { StatusTone } from '@/components/ui/status-pill';

export const SEVERITIES: { label: string; value: AlertSeverity }[] = [
  { label: 'Critical', value: 'critical' },
  { label: 'Warning', value: 'warning' },
  { label: 'Info', value: 'info' },
];

export function severityTone(severity: AlertSeverity | string | undefined): StatusTone {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'muted';
  }
}

export const COMPONENTS: { label: string; value: AlertComponent; icon: LucideIcon }[] = [
  { label: 'Cluster', value: 'cluster', icon: Boxes },
  { label: 'Broker', value: 'broker', icon: Server },
  { label: 'Topic', value: 'topic', icon: Layers },
  { label: 'Consumer group', value: 'consumerGroup', icon: Users },
  { label: 'Connector', value: 'connector', icon: Cable },
  { label: 'ksqlDB query', value: 'ksqlQuery', icon: FileCode2 },
  { label: 'Flink job', value: 'flinkJob', icon: Workflow },
  { label: 'Schema registry', value: 'schemaRegistry', icon: Database },
  { label: 'Custom (PromQL)', value: 'custom', icon: SlidersHorizontal },
];

export function componentIcon(component: string | undefined): LucideIcon {
  return COMPONENTS.find((c) => c.value === component)?.icon ?? Siren;
}

export function componentLabel(component: string | undefined): string {
  return COMPONENTS.find((c) => c.value === component)?.label ?? (component ?? '—');
}

export const CONDITIONS: { label: string; value: AlertCondition; symbol: string }[] = [
  { label: 'is greater than', value: 'gt', symbol: '>' },
  { label: 'is greater than or equal to', value: 'gte', symbol: '≥' },
  { label: 'is less than', value: 'lt', symbol: '<' },
  { label: 'is less than or equal to', value: 'lte', symbol: '≤' },
  { label: 'equals', value: 'eq', symbol: '=' },
  { label: 'does not equal', value: 'ne', symbol: '≠' },
];

export function conditionSymbol(condition: AlertCondition | string | undefined): string {
  return CONDITIONS.find((c) => c.value === condition)?.symbol ?? String(condition ?? '');
}

export const ACTION_TYPES: {
  label: string;
  value: AlertActionType;
  icon: LucideIcon;
  hint: string;
}[] = [
  { label: 'Email', value: 'email', icon: Mail, hint: 'Delivered through the configured SMTP server' },
  { label: 'Slack', value: 'slack', icon: MessageSquare, hint: 'Slack incoming webhook' },
  { label: 'PagerDuty', value: 'pagerduty', icon: Siren, hint: 'Events API v2 routing key' },
  { label: 'Webhook', value: 'webhook', icon: Webhook, hint: 'Generic HTTP POST with a template body' },
  { label: 'Microsoft Teams', value: 'teams', icon: MessageSquare, hint: 'Teams incoming webhook' },
];

export function actionTypeIcon(type: string | undefined): LucideIcon {
  return ACTION_TYPES.find((a) => a.value === type)?.icon ?? Webhook;
}

/**
 * Fallback metric catalog (mirrors ARCHITECTURE.md) so the trigger form stays
 * usable when `/alerts/metrics` is unavailable.
 */
export const FALLBACK_METRICS: AlertMetricCatalog = {
  cluster: [
    { name: 'underReplicatedPartitions', unit: 'partitions', description: 'Partitions with fewer in-sync replicas than configured' },
    { name: 'offlinePartitions', unit: 'partitions', description: 'Partitions with no active leader' },
    { name: 'activeControllerCount', unit: 'count', description: 'Should always be exactly 1' },
    { name: 'zkOrKraftUnavailable', unit: 'bool', description: 'Metadata quorum unreachable' },
    { name: 'brokerDownCount', unit: 'brokers', description: 'Brokers not reporting as online' },
    { name: 'bytesIn', unit: 'B/s', description: 'Cluster-wide ingress throughput' },
    { name: 'bytesOut', unit: 'B/s', description: 'Cluster-wide egress throughput' },
  ],
  broker: [
    { name: 'bytesIn', unit: 'B/s', description: 'Ingress throughput for this broker' },
    { name: 'bytesOut', unit: 'B/s', description: 'Egress throughput for this broker' },
    { name: 'produceRequestLatency', unit: 'ms', description: 'p99 produce request latency' },
    { name: 'fetchRequestLatency', unit: 'ms', description: 'p99 fetch request latency' },
    { name: 'diskUsagePct', unit: '%', description: 'Log directory utilisation' },
    { name: 'isOffline', unit: 'bool', description: 'Broker is not reachable' },
  ],
  topic: [
    { name: 'underReplicated', unit: 'partitions', description: 'Under-replicated partitions for this topic' },
    { name: 'bytesIn', unit: 'B/s', description: 'Produced bytes per second' },
    { name: 'bytesOut', unit: 'B/s', description: 'Consumed bytes per second' },
    { name: 'messagesIn', unit: 'msg/s', description: 'Records produced per second' },
    { name: 'sizeBytes', unit: 'B', description: 'Total size on disk' },
  ],
  consumerGroup: [
    { name: 'lag', unit: 'records', description: 'Total lag across all assigned partitions' },
    { name: 'lagPerPartition', unit: 'records', description: 'Highest lag on any single partition' },
    { name: 'consumptionDifference', unit: 'records', description: 'Produced minus consumed over the window' },
    { name: 'memberCount', unit: 'members', description: 'Active group members' },
    { name: 'isEmpty', unit: 'bool', description: 'Group has no active members' },
  ],
  connector: [
    { name: 'state', unit: 'state', description: 'Fires when the connector is not RUNNING' },
    { name: 'failedTasks', unit: 'tasks', description: 'Number of tasks in FAILED state' },
    { name: 'taskState', unit: 'state', description: 'Fires when any task leaves RUNNING' },
  ],
  ksqlQuery: [
    { name: 'errorRate', unit: 'errors/s', description: 'Query processing error rate' },
    { name: 'messagesConsumed', unit: 'msg/s', description: 'Records consumed by the query' },
  ],
  flinkJob: [
    { name: 'state', unit: 'state', description: 'Fires when the job is not RUNNING' },
    { name: 'restarts', unit: 'count', description: 'Number of full restarts' },
    { name: 'checkpointFailures', unit: 'count', description: 'Failed checkpoints' },
    { name: 'backpressure', unit: '%', description: 'Time spent backpressured' },
  ],
  schemaRegistry: [
    { name: 'unreachable', unit: 'bool', description: 'Schema registry is not responding' },
  ],
  custom: [{ name: 'promql', unit: '', description: 'Arbitrary PromQL expression evaluated per interval' }],
};

/** Components whose targets come from a cluster-scoped list API. */
export const TARGETED_COMPONENTS: AlertComponent[] = [
  'broker',
  'topic',
  'consumerGroup',
  'connector',
  'ksqlQuery',
  'flinkJob',
];

/** The alerts router is optional — surface a friendlier message when absent. */
export function isAlertsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501);
}

export interface TriggerPreviewInput {
  severity: AlertSeverity;
  component: AlertComponent;
  targetName?: string;
  targetRegex?: string;
  metric: string;
  condition: AlertCondition;
  value: number | string;
  unit?: string;
  bufferSeconds: number;
  clusterId?: string | null;
}

/** "Fire critical when consumer group `orders-*` lag > 1000 for 60s" */
export function triggerPreviewParts(input: TriggerPreviewInput) {
  const target = input.targetRegex || input.targetName || 'any';
  return {
    severity: input.severity,
    subject: `${componentLabel(input.component).toLowerCase()} ${target}`,
    metric: input.metric || 'metric',
    condition: conditionSymbol(input.condition),
    value: `${input.value}${input.unit ? ` ${input.unit}` : ''}`,
    buffer: input.bufferSeconds > 0 ? `for ${input.bufferSeconds}s` : 'immediately',
    cluster: input.clusterId ?? 'all clusters',
  };
}
