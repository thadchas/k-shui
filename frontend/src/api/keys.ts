/**
 * Query-key factories. Everything cluster-scoped is namespaced by cluster id so
 * switching clusters never reuses another cluster's cache.
 */
import type { AclQuery, AuditQuery, MessagesQuery, RangeParams, TopicListQuery } from './types';

const c = (cluster: string) => ['cluster', cluster] as const;

export const qk = {
  /* system */
  info: () => ['info'] as const,
  me: () => ['auth', 'me'] as const,
  audit: (query: AuditQuery) => ['audit', query] as const,

  /* clusters */
  clusters: () => ['clusters'] as const,
  cluster: (cluster: string) => [...c(cluster), 'detail'] as const,
  clusterHealth: (cluster: string) => [...c(cluster), 'health'] as const,
  clusterOverviewMetrics: (cluster: string, range: RangeParams) =>
    [...c(cluster), 'overview-metrics', range] as const,
  clusterConfigs: (cluster: string) => [...c(cluster), 'configs'] as const,
  kraftQuorum: (cluster: string) => [...c(cluster), 'kraft-quorum'] as const,
  replication: (cluster: string) => [...c(cluster), 'replication'] as const,

  /* brokers */
  brokers: (cluster: string) => [...c(cluster), 'brokers'] as const,
  broker: (cluster: string, id: number | string) => [...c(cluster), 'brokers', String(id)] as const,
  brokerConfigs: (cluster: string, id: number | string) =>
    [...c(cluster), 'brokers', String(id), 'configs'] as const,
  brokerLogDirs: (cluster: string, id: number | string) =>
    [...c(cluster), 'brokers', String(id), 'logdirs'] as const,
  brokerMetrics: (cluster: string, id: number | string, range: RangeParams) =>
    [...c(cluster), 'brokers', String(id), 'metrics', range] as const,

  /* topics */
  topics: (cluster: string, query: TopicListQuery) => [...c(cluster), 'topics', query] as const,
  topic: (cluster: string, topic: string) => [...c(cluster), 'topics', topic, 'detail'] as const,
  topicConfigs: (cluster: string, topic: string) =>
    [...c(cluster), 'topics', topic, 'configs'] as const,
  topicConsumers: (cluster: string, topic: string) =>
    [...c(cluster), 'topics', topic, 'consumers'] as const,
  topicMetrics: (cluster: string, topic: string, range: RangeParams) =>
    [...c(cluster), 'topics', topic, 'metrics', range] as const,
  topicSchema: (cluster: string, topic: string) =>
    [...c(cluster), 'topics', topic, 'schema'] as const,
  messages: (cluster: string, topic: string, query: MessagesQuery) =>
    [...c(cluster), 'topics', topic, 'messages', query] as const,

  /* consumer groups */
  consumerGroups: (cluster: string, query: { search?: string; state?: string }) =>
    [...c(cluster), 'consumer-groups', query] as const,
  consumerGroup: (cluster: string, group: string) =>
    [...c(cluster), 'consumer-groups', group] as const,
  consumerGroupLagHistory: (cluster: string, group: string, range: RangeParams) =>
    [...c(cluster), 'consumer-groups', group, 'lag-history', range] as const,
  shareGroups: (cluster: string) => [...c(cluster), 'share-groups'] as const,

  /* security */
  acls: (cluster: string, query: AclQuery) => [...c(cluster), 'acls', query] as const,
  quotas: (cluster: string) => [...c(cluster), 'quotas'] as const,
  scramUsers: (cluster: string) => [...c(cluster), 'scram-users'] as const,

  /* schema registry */
  schemaSubjects: (cluster: string, query: { search?: string; deleted?: boolean }) =>
    [...c(cluster), 'schemas', 'subjects', query] as const,
  schemaSubject: (cluster: string, subject: string) =>
    [...c(cluster), 'schemas', 'subjects', subject] as const,
  schemaVersion: (cluster: string, subject: string, version: number | string) =>
    [...c(cluster), 'schemas', 'subjects', subject, 'versions', String(version)] as const,
  schemaDiff: (cluster: string, subject: string, from: number, to: number) =>
    [...c(cluster), 'schemas', 'subjects', subject, 'diff', from, to] as const,
  schemaGlobalConfig: (cluster: string) => [...c(cluster), 'schemas', 'config'] as const,
  schemaRegistryInfo: (cluster: string) => [...c(cluster), 'schemas', 'info'] as const,

  /* connect */
  connectClusters: (cluster: string) => [...c(cluster), 'connect'] as const,
  connectors: (cluster: string, kc: string, query: Record<string, unknown>) =>
    [...c(cluster), 'connect', kc, 'connectors', query] as const,
  connector: (cluster: string, kc: string, name: string) =>
    [...c(cluster), 'connect', kc, 'connectors', name] as const,
  connectorConfig: (cluster: string, kc: string, name: string) =>
    [...c(cluster), 'connect', kc, 'connectors', name, 'config'] as const,
  connectorOffsets: (cluster: string, kc: string, name: string) =>
    [...c(cluster), 'connect', kc, 'connectors', name, 'offsets'] as const,
  connectPlugins: (cluster: string, kc: string) =>
    [...c(cluster), 'connect', kc, 'plugins'] as const,

  /* ksql */
  ksqlClusters: (cluster: string) => [...c(cluster), 'ksql'] as const,
  ksqlStreams: (cluster: string, k: string) => [...c(cluster), 'ksql', k, 'streams'] as const,
  ksqlTables: (cluster: string, k: string) => [...c(cluster), 'ksql', k, 'tables'] as const,
  ksqlQueries: (cluster: string, k: string) => [...c(cluster), 'ksql', k, 'queries'] as const,
  ksqlHistory: (cluster: string, k: string) => [...c(cluster), 'ksql', k, 'history'] as const,

  /* flink */
  flinkClusters: (cluster: string) => [...c(cluster), 'flink'] as const,
  flinkOverview: (cluster: string, f: string) => [...c(cluster), 'flink', f, 'overview'] as const,
  flinkJobs: (cluster: string, f: string) => [...c(cluster), 'flink', f, 'jobs'] as const,
  flinkJob: (cluster: string, f: string, jid: string) =>
    [...c(cluster), 'flink', f, 'jobs', jid] as const,
  flinkCheckpoints: (cluster: string, f: string, jid: string) =>
    [...c(cluster), 'flink', f, 'jobs', jid, 'checkpoints'] as const,
  flinkExceptions: (cluster: string, f: string, jid: string) =>
    [...c(cluster), 'flink', f, 'jobs', jid, 'exceptions'] as const,
  flinkTaskManagers: (cluster: string, f: string) =>
    [...c(cluster), 'flink', f, 'taskmanagers'] as const,
  flinkJars: (cluster: string, f: string) => [...c(cluster), 'flink', f, 'jars'] as const,

  /* metrics */
  metricsStatus: (cluster: string) => [...c(cluster), 'metrics', 'status'] as const,
  metricsCatalog: (cluster: string, search?: string) =>
    [...c(cluster), 'metrics', 'catalog', search ?? ''] as const,
  dashboards: (cluster: string) => [...c(cluster), 'metrics', 'dashboards'] as const,
  dashboard: (cluster: string, id: string) => [...c(cluster), 'metrics', 'dashboards', id] as const,
  dashboardData: (cluster: string, id: string, range: RangeParams) =>
    [...c(cluster), 'metrics', 'dashboards', id, 'data', range] as const,
  promQuery: (cluster: string, query: string, time?: string) =>
    [...c(cluster), 'metrics', 'query', query, time ?? ''] as const,
  promQueryRange: (cluster: string, query: string, range: RangeParams) =>
    [...c(cluster), 'metrics', 'query_range', query, range] as const,

  /* lineage */
  lineageGraph: (cluster: string, params: Record<string, unknown>) =>
    [...c(cluster), 'lineage', 'graph', params] as const,
  lineageNode: (cluster: string, id: string) => [...c(cluster), 'lineage', 'node', id] as const,
  lineageSearch: (cluster: string, q: string) => [...c(cluster), 'lineage', 'search', q] as const,
  lineageNamespaces: (cluster: string) => [...c(cluster), 'lineage', 'namespaces'] as const,

  /* alerts (global, not cluster-scoped) */
  alertTriggers: () => ['alerts', 'triggers'] as const,
  alertTrigger: (id: string) => ['alerts', 'triggers', id] as const,
  alertActions: () => ['alerts', 'actions'] as const,
  alertAction: (id: string) => ['alerts', 'actions', id] as const,
  alertHistory: (query: Record<string, unknown>) => ['alerts', 'history', query] as const,
  alertSummary: () => ['alerts', 'summary'] as const,
  alertMetrics: () => ['alerts', 'metrics'] as const,
} as const;

/** Invalidate everything belonging to a cluster. */
export const clusterScope = (cluster: string) => ['cluster', cluster] as const;
