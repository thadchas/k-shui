/**
 * Default fixture payloads for the e2e suite.
 *
 * Every value is typed against the real API contract in `src/api/types.ts`, so a contract
 * change breaks `tsc` here rather than producing a suite that passes against a shape the app
 * no longer receives.
 *
 * The defaults describe a *healthy* two-cluster deployment. Incident payloads
 * (`unhealthyPartitions`, `failedConnectors`, `failedFlinkJobs`, `laggingGroups`,
 * `unknownLagGroupDetail`, `connectionTestPartial`) are exported alongside them and opted
 * into per test with `api.on(...)`.
 */
import type {
  AlertSummary,
  AlertTrigger,
  ClusterDetail,
  ClusterHealth,
  ClusterSummary,
  ConnectCluster,
  ConnectionTestResponse,
  Connector,
  ConsumerGroupDetail,
  ConsumerGroupSummary,
  FeatureFlags,
  FlinkCluster,
  FlinkJob,
  FlinkTaskCounts,
  InfoResponse,
  KRaftQuorum,
  LineageEdge,
  LineageGraphFull,
  LineageNodeFull,
  Page,
  PartitionDetail,
  SchemaSubjectSummary,
  SeriesResponse,
  TopicDetail,
  TopicSummary,
  UnhealthyPartition,
  UnhealthyPartitionsResponse,
  User,
} from '../../src/api/types';

export const CLUSTER_ID = 'local';
export const CLUSTER_NAME = 'Local Kafka';
export const OTHER_CLUSTER_ID = 'staging';
export const OTHER_CLUSTER_NAME = 'Staging Kafka';

export const CONNECT_CLUSTER = 'connect-1';
export const FLINK_CLUSTER = 'flink-1';

export const TOPIC_ORDERS = 'orders.v1';
export const TOPIC_PAYMENTS = 'payments.v2';
/** Deliberately long — exercises truncation + the copy affordance on the Topics table. */
export const TOPIC_LONG = 'analytics.clickstream.enriched.aggregated.v3.eu-west-1';

export const GROUP_ORDERS = 'orders-processor';
export const GROUP_BILLING = 'billing-sync';

export const CONNECTOR_SINK = 'es-sink';
export const CONNECTOR_SOURCE = 'pg-source';

export const FLINK_JOB_ID = '9f2b4c1e7a3d5f60';
export const FLINK_JOB_NAME = 'sessionizer';

export const SCHEMA_ORDERS = 'orders.v1-value';
export const SCHEMA_USERS = 'users.profile-value';

export const ADMIN_USER: User = {
  username: 'admin',
  role: 'admin',
  email: 'admin@example.test',
  displayName: 'E2E Admin',
};

export const ADMIN_TOKEN = 'e2e-admin-token';

const FEATURES: FeatureFlags = {
  schemaRegistry: true,
  connect: true,
  ksqldb: true,
  flink: true,
  prometheus: true,
  lineage: true,
};

export const info: InfoResponse = {
  version: '0.4.0-e2e',
  uptimeSeconds: 4321,
  auth: { type: 'basic', enabled: true, user: ADMIN_USER },
  features: { ...FEATURES },
  clusters: [
    { id: CLUSTER_ID, name: CLUSTER_NAME },
    { id: OTHER_CLUSTER_ID, name: OTHER_CLUSTER_NAME },
  ],
};

function clusterSummary(id: string, name: string): ClusterSummary {
  return {
    id,
    name,
    status: 'online',
    version: '3.9.0',
    controllerId: 1,
    brokerCount: 3,
    onlineBrokers: 3,
    topicCount: 24,
    partitionCount: 96,
    underReplicatedPartitions: 0,
    offlinePartitions: 0,
    inSyncReplicasPct: 100,
    bytesInPerSec: 148_000,
    bytesOutPerSec: 96_000,
    features: { ...FEATURES },
  };
}

export const clusters: ClusterSummary[] = [
  clusterSummary(CLUSTER_ID, CLUSTER_NAME),
  clusterSummary(OTHER_CLUSTER_ID, OTHER_CLUSTER_NAME),
];

export function clusterDetail(id: string): ClusterDetail {
  const summary = clusters.find((c) => c.id === id) ?? clusterSummary(id, id);
  return {
    ...summary,
    clusterId: `kafka-${id}-0001`,
    listeners: ['PLAINTEXT://broker-1:9092', 'PLAINTEXT://broker-2:9092'],
    kraft: { leaderId: 1, epoch: 7, voters: [1, 2, 3], observers: [] },
  };
}

export const clusterHealth: ClusterHealth = {
  status: 'healthy',
  checks: [
    { name: 'brokers', status: 'healthy', message: '3/3 brokers online' },
    { name: 'controller', status: 'healthy', message: 'controller 1' },
    { name: 'partitions', status: 'healthy', message: 'no offline partitions' },
  ],
};

export const kraftQuorum: KRaftQuorum = {
  leaderId: 1,
  leaderEpoch: 7,
  highWatermark: 90_210,
  voters: [
    { id: 1, logEndOffset: 90_210, lastFetchTs: null, lastCaughtUpTs: null, lag: 0 },
    { id: 2, logEndOffset: 90_208, lastFetchTs: null, lastCaughtUpTs: null, lag: 2 },
    { id: 3, logEndOffset: 90_210, lastFetchTs: null, lastCaughtUpTs: null, lag: 0 },
  ],
  observers: [],
};

/** Deterministic, monotonically-timestamped series so charts have something to draw. */
export function series(names: string[]): SeriesResponse {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  return {
    series: names.map((name, s) => ({
      name,
      points: Array.from(
        { length: 12 },
        (_, i) => [start + i * 300_000, (s + 1) * 1000 + i * 10] as [number, number],
      ),
    })),
  };
}

export const overviewMetrics: SeriesResponse = series([
  'bytesIn',
  'bytesOut',
  'messagesIn',
  'requestRate',
  'underReplicated',
  'offlinePartitions',
]);

/* --------------------------------- topics --------------------------------- */

function topic(overrides: Partial<TopicSummary> & { name: string }): TopicSummary {
  return {
    partitions: 6,
    replicationFactor: 3,
    isInternal: false,
    underReplicatedPartitions: 0,
    sizeBytes: 12_582_912,
    messageCount: 184_320,
    cleanupPolicy: 'delete',
    retentionMs: 604_800_000,
    hasSchema: { key: false, value: true },
    bytesInPerSec: 0,
    bytesOutPerSec: 0,
    ...overrides,
  };
}

export const topics: TopicSummary[] = [
  topic({ name: TOPIC_LONG, partitions: 12, bytesInPerSec: 51_200, bytesOutPerSec: 24_100 }),
  topic({ name: TOPIC_ORDERS, bytesInPerSec: 148_000, bytesOutPerSec: 96_000 }),
  topic({
    name: TOPIC_PAYMENTS,
    partitions: 3,
    underReplicatedPartitions: 2,
    hasSchema: { key: true, value: true },
  }),
  topic({
    name: '__consumer_offsets',
    partitions: 50,
    isInternal: true,
    cleanupPolicy: 'compact',
    retentionMs: null,
    hasSchema: { key: false, value: false },
  }),
];

export function topicsPage(query: URLSearchParams): Page<TopicSummary> {
  const search = (query.get('search') ?? '').toLowerCase();
  const showInternal = query.get('showInternal') === 'true';
  const items = topics
    .filter((t) => showInternal || !t.isInternal)
    .filter((t) => !search || t.name.toLowerCase().includes(search));
  return {
    items,
    page: Number(query.get('page') ?? 1),
    perPage: Number(query.get('perPage') ?? 50),
    total: items.length,
  };
}

export const partitionsDetail: PartitionDetail[] = [
  {
    id: 0,
    leader: 1,
    replicas: [1, 2, 3],
    isr: [1, 2, 3],
    beginOffset: 0,
    endOffset: 41_002,
    sizeBytes: 4_194_304,
  },
  {
    id: 1,
    leader: 2,
    replicas: [2, 3, 1],
    isr: [2, 3, 1],
    beginOffset: 0,
    endOffset: 39_884,
    sizeBytes: 4_194_304,
  },
  {
    id: 2,
    leader: 3,
    replicas: [3, 1, 2],
    isr: [3, 1, 2],
    beginOffset: 0,
    endOffset: 40_110,
    sizeBytes: 4_194_304,
  },
];

export function topicDetail(name: string): TopicDetail {
  const summary = topics.find((t) => t.name === name) ?? topic({ name });
  return {
    ...summary,
    partitionsDetail,
    configs: { 'cleanup.policy': summary.cleanupPolicy, 'retention.ms': '604800000' },
  };
}

/* ---------------------------- consumer groups ----------------------------- */

function group(
  overrides: Partial<ConsumerGroupSummary> & { groupId: string },
): ConsumerGroupSummary {
  return {
    groupType: 'consumer',
    state: 'Stable',
    protocolType: 'consumer',
    protocol: 'range',
    coordinatorId: 1,
    memberCount: 2,
    topicCount: 1,
    partitionCount: 6,
    totalLag: 0,
    isSimple: false,
    maxTimeLagMs: null,
    ...overrides,
  };
}

export const consumerGroups: ConsumerGroupSummary[] = [
  group({ groupId: GROUP_ORDERS, memberCount: 3 }),
  group({ groupId: GROUP_BILLING, state: 'Empty', memberCount: 0 }),
];

export function consumerGroupList(query: URLSearchParams): ConsumerGroupSummary[] {
  const search = (query.get('search') ?? '').toLowerCase();
  return consumerGroups.filter((g) => !search || g.groupId.toLowerCase().includes(search));
}

/** Membership "Stable" but lag outstanding — the processing-health split the UI must show. */
export const laggingGroupDetail: ConsumerGroupDetail = {
  ...group({ groupId: GROUP_ORDERS, memberCount: 2, totalLag: 42_000, maxTimeLagMs: 420_000 }),
  members: [
    {
      memberId: 'consumer-1-aaaa',
      clientId: 'orders-worker-a',
      host: '/10.1.0.11',
      assignments: [
        { topic: TOPIC_ORDERS, partition: 0 },
        { topic: TOPIC_ORDERS, partition: 1 },
        { topic: TOPIC_ORDERS, partition: 2 },
        { topic: TOPIC_ORDERS, partition: 3 },
      ],
    },
    {
      memberId: 'consumer-2-bbbb',
      clientId: 'orders-worker-b',
      host: '/10.1.0.12',
      assignments: [
        { topic: TOPIC_ORDERS, partition: 4 },
        { topic: TOPIC_ORDERS, partition: 5 },
      ],
    },
  ],
  partitions: [
    {
      topic: TOPIC_ORDERS,
      partition: 0,
      currentOffset: 40_100,
      endOffset: 40_112,
      lag: 12,
      memberId: 'consumer-1-aaaa',
      clientId: 'orders-worker-a',
      host: '/10.1.0.11',
      timeLagMs: 1_000,
    },
    {
      topic: TOPIC_ORDERS,
      partition: 1,
      currentOffset: 3_000,
      endOffset: 44_884,
      lag: 41_884,
      memberId: 'consumer-1-aaaa',
      clientId: 'orders-worker-a',
      host: '/10.1.0.11',
      timeLagMs: 420_000,
    },
    {
      topic: TOPIC_ORDERS,
      partition: 2,
      currentOffset: 40_106,
      endOffset: 40_110,
      lag: 4,
      memberId: 'consumer-2-bbbb',
      clientId: 'orders-worker-b',
      host: '/10.1.0.12',
      timeLagMs: null,
    },
  ],
  topicsSummary: [{ topic: TOPIC_ORDERS, lag: 42_000, partitions: 6 }],
};

/** Same group with no lag reading at all — must resolve to "No data", never "Caught up". */
export const unknownLagGroupDetail: Omit<ConsumerGroupDetail, 'totalLag'> = (() => {
  const { totalLag: _totalLag, ...rest } = laggingGroupDetail;
  return {
    ...rest,
    maxTimeLagMs: null,
    partitions: rest.partitions.map((p) => ({ ...p, lag: null, timeLagMs: null })),
    topicsSummary: [],
  };
})();

export const emptyLagHistory: SeriesResponse = { series: [] };

/* --------------------------------- connect -------------------------------- */

export const connectClusters: ConnectCluster[] = [
  {
    name: CONNECT_CLUSTER,
    url: 'http://connect:8083',
    version: '3.9.0',
    commit: 'abc1234',
    kafkaClusterId: 'kafka-local-0001',
    status: 'online',
    connectorCount: 2,
    runningTasks: 4,
    failedTasks: 0,
  },
];

function connector(overrides: Partial<Connector> & { name: string }): Connector {
  return {
    type: 'sink',
    connectorClass: 'io.confluent.connect.elasticsearch.ElasticsearchSinkConnector',
    state: 'RUNNING',
    workerId: 'connect-1:8083',
    tasks: [{ id: 0, state: 'RUNNING', workerId: 'connect-1:8083', trace: null }],
    topics: [TOPIC_ORDERS],
    config: { 'connector.class': 'ElasticsearchSinkConnector', 'tasks.max': '2' },
    trace: null,
    ...overrides,
  };
}

export const connectors: Connector[] = [
  connector({ name: CONNECTOR_SINK }),
  connector({
    name: CONNECTOR_SOURCE,
    type: 'source',
    connectorClass: 'io.debezium.connector.postgresql.PostgresConnector',
  }),
];

export const failedConnectors: Connector[] = [
  connector({
    name: CONNECTOR_SINK,
    state: 'FAILED',
    trace:
      'org.apache.kafka.connect.errors.ConnectException: index [orders] not found\n\tat io.confluent...',
  }),
  connector({ name: CONNECTOR_SOURCE, type: 'source' }),
];

/* ---------------------------------- flink --------------------------------- */

export const flinkClusters: FlinkCluster[] = [
  {
    name: FLINK_CLUSTER,
    url: 'http://flink:8081',
    version: '1.20.0',
    status: 'online',
    taskmanagers: 2,
    slotsTotal: 8,
    slotsAvailable: 3,
    jobsRunning: 2,
    jobsFinished: 5,
    jobsCancelled: 0,
    jobsFailed: 0,
  },
];

const taskCounts: FlinkTaskCounts = {
  total: 4,
  running: 4,
  finished: 0,
  canceling: 0,
  canceled: 0,
  failed: 0,
  created: 0,
  scheduled: 0,
  deploying: 0,
  reconciling: 0,
  initializing: 0,
};

function flinkJob(overrides: Partial<FlinkJob> & { jid: string; name: string }): FlinkJob {
  return {
    state: 'RUNNING',
    startTime: Date.UTC(2026, 0, 1, 0, 0, 0),
    endTime: -1,
    duration: 3_600_000,
    tasks: { ...taskCounts },
    ...overrides,
  };
}

export const flinkJobs: FlinkJob[] = [
  flinkJob({ jid: FLINK_JOB_ID, name: FLINK_JOB_NAME }),
  flinkJob({ jid: 'aa11bb22cc33dd44', name: 'enricher' }),
];

export const failedFlinkJobs: FlinkJob[] = [
  flinkJob({
    jid: FLINK_JOB_ID,
    name: FLINK_JOB_NAME,
    state: 'FAILED',
    tasks: { ...taskCounts, running: 0, failed: 4 },
  }),
  flinkJob({ jid: 'aa11bb22cc33dd44', name: 'enricher' }),
];

/* -------------------------------- schemas --------------------------------- */

export const schemaSubjects: SchemaSubjectSummary[] = [
  {
    subject: SCHEMA_ORDERS,
    latestVersion: 4,
    schemaType: 'AVRO',
    compatibility: 'BACKWARD',
    versionsCount: 4,
    topic: TOPIC_ORDERS,
  },
  {
    subject: SCHEMA_USERS,
    latestVersion: 2,
    schemaType: 'AVRO',
    compatibility: 'FULL',
    versionsCount: 2,
    topic: null,
  },
];

export function schemaSubjectList(query: URLSearchParams): SchemaSubjectSummary[] {
  const search = (query.get('search') ?? '').toLowerCase();
  return schemaSubjects.filter((s) => !search || s.subject.toLowerCase().includes(search));
}

/* --------------------------------- alerts --------------------------------- */

export const alertTriggers: AlertTrigger[] = [
  {
    id: 'trg-lag',
    name: 'Consumer lag above 10k',
    clusterId: CLUSTER_ID,
    component: 'consumerGroup',
    target: { name: GROUP_ORDERS },
    metric: 'consumer_lag',
    condition: 'gt',
    value: 10_000,
    bufferSeconds: 120,
    severity: 'warning',
    enabled: true,
    actionIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

export const alertSummary: AlertSummary = {
  total: 1,
  bySeverity: { critical: 0, warning: 1, info: 0 },
};

/* -------------------------------- partitions ------------------------------ */

export const healthyPartitions: UnhealthyPartitionsResponse = {
  items: [],
  offline: 0,
  underReplicated: 0,
  nonPreferredLeader: 0,
  scannedPartitions: 96,
};

const unhealthyItems: UnhealthyPartition[] = [
  {
    topic: TOPIC_PAYMENTS,
    partition: 0,
    leader: null,
    replicas: [1, 2, 3],
    isr: [],
    reasons: ['offline'],
  },
  {
    topic: TOPIC_PAYMENTS,
    partition: 1,
    leader: null,
    replicas: [1, 2, 3],
    isr: [],
    reasons: ['offline'],
  },
  {
    topic: TOPIC_ORDERS,
    partition: 4,
    leader: 2,
    replicas: [2, 3, 1],
    isr: [2],
    reasons: ['underReplicated'],
  },
  {
    topic: TOPIC_ORDERS,
    partition: 5,
    leader: 3,
    replicas: [3, 1, 2],
    isr: [3, 1],
    reasons: ['underReplicated'],
  },
  {
    topic: TOPIC_ORDERS,
    partition: 2,
    leader: 3,
    replicas: [1, 2, 3],
    isr: [1, 2, 3],
    reasons: ['nonPreferredLeader'],
  },
];

/** Two offline partitions on payments.v2 (tier 0 critical) + two URPs on orders.v1 (tier 0 warning). */
export const unhealthyPartitions: UnhealthyPartitionsResponse = {
  items: unhealthyItems,
  offline: 2,
  underReplicated: 2,
  nonPreferredLeader: 1,
  scannedPartitions: 96,
};

/** Over `LAG_CRITICAL_THRESHOLD` (1M) so it ranks without needing repeated polls. */
export const laggingGroups: ConsumerGroupSummary[] = [
  group({ groupId: GROUP_ORDERS, memberCount: 3, totalLag: 2_400_000 }),
  group({ groupId: GROUP_BILLING, state: 'Empty', memberCount: 0 }),
];

/* -------------------------------- lineage --------------------------------- */

export const LINEAGE_FOCUS = `topic:${CLUSTER_ID}:${TOPIC_ORDERS}`;
const LINEAGE_UPSTREAM = `connector:${CLUSTER_ID}:${CONNECT_CLUSTER}:${CONNECTOR_SOURCE}`;
const LINEAGE_DOWNSTREAM_GROUP = `consumerGroup:${CLUSTER_ID}:${GROUP_ORDERS}`;
const LINEAGE_DOWNSTREAM_JOB = `flinkJob:${CLUSTER_ID}:${FLINK_CLUSTER}:${FLINK_JOB_ID}`;

const lineageNodes: LineageNodeFull[] = [
  {
    id: LINEAGE_UPSTREAM,
    type: 'connector',
    label: CONNECTOR_SOURCE,
    namespace: 'kafka-connect',
    status: 'RUNNING',
    clusterId: CLUSTER_ID,
    meta: {},
  },
  {
    id: LINEAGE_FOCUS,
    type: 'topic',
    label: TOPIC_ORDERS,
    namespace: 'kafka',
    status: null,
    clusterId: CLUSTER_ID,
    meta: {},
  },
  {
    id: LINEAGE_DOWNSTREAM_GROUP,
    type: 'consumerGroup',
    label: GROUP_ORDERS,
    namespace: 'kafka',
    status: 'Stable',
    clusterId: CLUSTER_ID,
    meta: {},
  },
  {
    id: LINEAGE_DOWNSTREAM_JOB,
    type: 'flinkJob',
    label: FLINK_JOB_NAME,
    namespace: 'flink',
    status: 'RUNNING',
    clusterId: CLUSTER_ID,
    meta: {},
  },
];

const lineageEdges: LineageEdge[] = [
  { id: 'e-source-topic', source: LINEAGE_UPSTREAM, target: LINEAGE_FOCUS, kind: 'produces' },
  {
    id: 'e-topic-group',
    source: LINEAGE_FOCUS,
    target: LINEAGE_DOWNSTREAM_GROUP,
    kind: 'consumes',
  },
  { id: 'e-topic-job', source: LINEAGE_FOCUS, target: LINEAGE_DOWNSTREAM_JOB, kind: 'transforms' },
];

export const lineageGraph: LineageGraphFull = {
  nodes: lineageNodes,
  edges: lineageEdges,
  sources: ['connect', 'flink', 'consumers'],
  clusterId: CLUSTER_ID,
  focus: LINEAGE_FOCUS,
};

/* --------------------------- connection tester ---------------------------- */

const GENERATED_YAML = `clusters:
  - id: local
    name: Local Kafka
    bootstrapServers: broker-1:9092
    schemaRegistry:
      type: confluent
      url: http://schema-registry:8081
      auth:
        username: \${KSHUI_LOCAL_SCHEMA_REGISTRY_USERNAME}
        password: \${KSHUI_LOCAL_SCHEMA_REGISTRY_PASSWORD}
`;

/** Kafka reachable, registry rejects the credentials — the "which layer failed?" case. */
export const connectionTestPartial: ConnectionTestResponse = {
  ok: false,
  clusterId: CLUSTER_ID,
  durationMs: 812,
  components: [
    {
      component: 'kafka',
      label: 'Kafka',
      target: 'broker-1:9092',
      status: 'ok',
      category: 'none',
      latencyMs: 42,
      detail: 'Connected and described the cluster.',
      metadata: { brokerCount: 3, topicCount: 24, clusterId: 'kafka-local-0001' },
    },
    {
      component: 'schemaRegistry',
      label: 'Schema Registry',
      target: 'http://schema-registry:8081',
      status: 'auth_failed',
      category: 'credentials',
      latencyMs: 18,
      detail: 'The registry answered 401 Unauthorized.',
      metadata: {},
    },
    {
      component: 'connect',
      label: 'Kafka Connect',
      target: 'http://connect:8083',
      status: 'unreachable',
      category: 'connectivity',
      latencyMs: null,
      detail: 'Connection refused after 5s.',
      metadata: {},
    },
  ],
  config: {
    yaml: GENERATED_YAML,
    envVars: [
      {
        name: 'KSHUI_LOCAL_SCHEMA_REGISTRY_USERNAME',
        component: 'schemaRegistry',
        description: 'Schema Registry basic-auth user',
      },
      {
        name: 'KSHUI_LOCAL_SCHEMA_REGISTRY_PASSWORD',
        component: 'schemaRegistry',
        description: 'Schema Registry basic-auth password',
      },
    ],
  },
};

export const connectionTestAllOk: ConnectionTestResponse = {
  ok: true,
  clusterId: CLUSTER_ID,
  durationMs: 233,
  components: [
    {
      component: 'kafka',
      label: 'Kafka',
      target: 'broker-1:9092',
      status: 'ok',
      category: 'none',
      latencyMs: 31,
      detail: 'Connected and described the cluster.',
      metadata: { brokerCount: 3, topicCount: 24 },
    },
  ],
  config: { yaml: GENERATED_YAML, envVars: [] },
};
