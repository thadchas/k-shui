/* -----------------------------------------------------------------------------
 * k-shui API types — mirrors the REST contract in ARCHITECTURE.md (/api/v1).
 * All fields camelCase, errors are RFC 9457 problem+json.
 * -------------------------------------------------------------------------- */

/* ---------------------------------- common -------------------------------- */

export interface Page<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}

export type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export interface RangeParams {
  range?: TimeRange | string;
  start?: string | number;
  end?: string | number;
  step?: string | number;
}

/** [timestampMs, value] */
export type SeriesPoint = [number, number];

export interface Series {
  name: string;
  labels?: Record<string, string>;
  points: SeriesPoint[];
}

export interface SeriesResponse {
  series: Series[];
}

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type OnlineStatus = 'online' | 'degraded' | 'offline' | 'unknown';

/* ---------------------------------- system -------------------------------- */

export type AuthType = 'none' | 'basic' | 'oidc';

export interface FeatureFlags {
  schemaRegistry: boolean;
  connect: boolean;
  ksqldb: boolean;
  flink: boolean;
  prometheus: boolean;
  lineage: boolean;
  [key: string]: boolean;
}

export interface InfoResponse {
  version: string;
  uptimeSeconds: number;
  auth: { type: AuthType; enabled: boolean };
  features: Partial<FeatureFlags> & Record<string, boolean>;
  clusters: { id: string; name: string }[];
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  username: string;
  role: UserRole;
  email?: string | null;
  displayName?: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface AuditEntry {
  id: string | number;
  ts: string;
  user: string;
  action: string;
  resource: string;
  clusterId: string | null;
  details: Record<string, unknown> | string | null;
  ip: string | null;
}

export interface AuditQuery {
  page?: number;
  perPage?: number;
  clusterId?: string;
  user?: string;
  action?: string;
}

export interface ServerEvent<T = unknown> {
  type: string;
  clusterId: string | null;
  ts: string;
  payload: T;
}

/* --------------------------------- clusters ------------------------------- */

export interface ClusterSummary {
  id: string;
  name: string;
  status: OnlineStatus;
  version: string | null;
  controllerId: number | null;
  brokerCount: number;
  onlineBrokers: number;
  topicCount: number;
  partitionCount: number;
  underReplicatedPartitions: number;
  offlinePartitions: number;
  inSyncReplicasPct: number | null;
  bytesInPerSec: number | null;
  bytesOutPerSec: number | null;
  features: FeatureFlags;
}

export interface KRaftInfo {
  leaderId: number | null;
  epoch: number | null;
  voters: number[] | KRaftReplica[];
  observers: number[] | KRaftReplica[];
}

export interface ClusterDetail extends ClusterSummary {
  clusterId: string | null;
  listeners: string[];
  kraft: KRaftInfo | null;
}

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message: string | null;
}

export interface ClusterHealth {
  status: HealthStatus;
  checks: HealthCheck[];
}

export interface KRaftReplica {
  id: number;
  logEndOffset: number;
  lastFetchTs: number | null;
  lastCaughtUpTs: number | null;
  lag: number;
}

export interface KRaftQuorum {
  leaderId: number | null;
  leaderEpoch: number | null;
  highWatermark: number | null;
  voters: KRaftReplica[];
  observers: KRaftReplica[];
}

/* --------------------------------- brokers -------------------------------- */

export interface Broker {
  id: number;
  host: string;
  port: number;
  rack: string | null;
  isController: boolean;
  partitionCount: number;
  leaderCount: number;
  underReplicatedPartitions: number;
  logDirSizeBytes: number | null;
  status: 'online' | 'offline';
  version: string | null;
}

export interface ConfigEntry {
  name: string;
  value: string | null;
  source: string;
  isDefault: boolean;
  isReadOnly: boolean;
  isSensitive: boolean;
  documentation: string | null;
}

export interface ConfigUpdateRequest {
  configs: Record<string, string | null>;
}

export interface LogDirPartition {
  topic: string;
  partition: number;
  sizeBytes: number;
  offsetLag: number;
}

export interface LogDir {
  path: string;
  sizeBytes: number;
  partitions: LogDirPartition[];
}

/* ---------------------------------- topics -------------------------------- */

export type CleanupPolicy = 'delete' | 'compact' | 'compact,delete';

export interface TopicSchemaFlags {
  key: boolean;
  value: boolean;
}

export interface TopicSummary {
  name: string;
  partitions: number;
  replicationFactor: number;
  isInternal: boolean;
  underReplicatedPartitions: number;
  sizeBytes: number;
  messageCount: number;
  cleanupPolicy: string;
  retentionMs: number | null;
  hasSchema: TopicSchemaFlags;
  bytesInPerSec: number | null;
  bytesOutPerSec: number | null;
}

export interface PartitionDetail {
  id: number;
  leader: number | null;
  replicas: number[];
  isr: number[];
  beginOffset: number;
  endOffset: number;
  sizeBytes: number;
}

export interface TopicDetail extends TopicSummary {
  partitionsDetail: PartitionDetail[];
  configs?: Record<string, string> | ConfigEntry[];
}

export interface TopicListQuery {
  search?: string;
  showInternal?: boolean;
  page?: number;
  perPage?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface CreateTopicRequest {
  name: string;
  partitions: number;
  replicationFactor: number;
  configs?: Record<string, string>;
}

export interface AddPartitionsRequest {
  count: number;
}

export interface PurgeTopicRequest {
  partitions?: { id: number; beforeOffset: number }[];
}

export interface CloneTopicRequest {
  name: string;
}

export interface TopicConsumer {
  groupId: string;
  state: ConsumerGroupState;
  lag: number;
  members: number;
}

export interface TopicSchemaRef {
  subject: string;
  version: number;
  schemaId: number;
  type: SchemaType;
}

export interface TopicSchemaInfo {
  key: TopicSchemaRef | null;
  value: TopicSchemaRef | null;
  strategy: string | null;
}

/* --------------------------------- messages ------------------------------- */

export type MessageFormat =
  | 'auto'
  | 'string'
  | 'json'
  | 'avro'
  | 'protobuf'
  | 'jsonschema'
  | 'base64'
  | 'hex'
  | 'int'
  | 'long';

export type MessageMode = 'latest' | 'earliest' | 'offset' | 'timestamp';
export type FilterMode = 'contains' | 'jsonpath' | 'regex';

export interface Message {
  partition: number;
  offset: number;
  timestamp: number;
  timestampType: string | null;
  key: unknown;
  keyFormat: MessageFormat | string | null;
  value: unknown;
  valueFormat: MessageFormat | string | null;
  headers: Record<string, string>;
  keySchemaId: number | null;
  valueSchemaId: number | null;
  sizeBytes: number;
  keyRaw?: string | null;
  valueRaw?: string | null;
}

export interface MessagesQuery {
  mode?: MessageMode;
  partitions?: number[] | string;
  offset?: number;
  timestamp?: number;
  limit?: number;
  keyFormat?: MessageFormat;
  valueFormat?: MessageFormat;
  filter?: string;
  filterMode?: FilterMode;
  stream?: boolean;
}

export interface MessagesResponse {
  items: Message[];
  scanned: number;
}

export interface MessageProgress {
  scanned: number;
  matched: number;
  done: boolean;
}

export interface ProduceMessageRequest {
  partition?: number | null;
  key?: string | null;
  value: string;
  headers?: Record<string, string>;
  keyFormat: MessageFormat;
  valueFormat: MessageFormat;
  keySchemaSubject?: string | null;
  valueSchemaSubject?: string | null;
}

export interface ProduceMessageResponse {
  partition: number;
  offset: number;
}

export type ExportFormat = 'json' | 'csv' | 'ndjson';

/* ----------------------------- consumer groups ---------------------------- */

export type ConsumerGroupState =
  | 'Stable'
  | 'Empty'
  | 'PreparingRebalance'
  | 'CompletingRebalance'
  | 'Dead'
  | 'Unknown'
  | string;

export type GroupType = 'classic' | 'consumer' | 'share';

export interface ConsumerGroupSummary {
  groupId: string;
  groupType: GroupType;
  state: ConsumerGroupState;
  protocolType: string | null;
  protocol: string | null;
  coordinatorId: number | null;
  memberCount: number;
  topicCount: number;
  partitionCount: number;
  totalLag: number;
  isSimple: boolean;
}

export interface ConsumerGroupMember {
  memberId: string;
  clientId: string;
  host: string;
  assignments: { topic: string; partition: number }[];
}

export interface ConsumerGroupPartition {
  topic: string;
  partition: number;
  currentOffset: number | null;
  endOffset: number | null;
  lag: number | null;
  memberId: string | null;
  clientId: string | null;
  host: string | null;
}

export interface ConsumerGroupTopicSummary {
  topic: string;
  lag: number;
  partitions: number;
}

export interface ConsumerGroupDetail extends ConsumerGroupSummary {
  members: ConsumerGroupMember[];
  partitions: ConsumerGroupPartition[];
  topicsSummary: ConsumerGroupTopicSummary[];
}

export type ResetStrategy = 'earliest' | 'latest' | 'offset' | 'timestamp' | 'shiftBy';

export interface ResetOffsetsRequest {
  topic?: string;
  partitions?: number[];
  strategy: ResetStrategy;
  value?: number | string;
  dryRun?: boolean;
}

export interface ResetOffsetsResult {
  topic: string;
  partition: number;
  oldOffset: number | null;
  newOffset: number | null;
}

export interface ShareGroupsResponse {
  supported: boolean;
  items?: ConsumerGroupSummary[];
}

/* --------------------------------- security ------------------------------- */

export type AclResourceType =
  | 'TOPIC'
  | 'GROUP'
  | 'CLUSTER'
  | 'TRANSACTIONAL_ID'
  | 'DELEGATION_TOKEN'
  | 'USER'
  | 'ANY';
export type AclPatternType = 'LITERAL' | 'PREFIXED' | 'MATCH' | 'ANY';
export type AclOperation =
  | 'ALL'
  | 'READ'
  | 'WRITE'
  | 'CREATE'
  | 'DELETE'
  | 'ALTER'
  | 'DESCRIBE'
  | 'CLUSTER_ACTION'
  | 'DESCRIBE_CONFIGS'
  | 'ALTER_CONFIGS'
  | 'IDEMPOTENT_WRITE'
  | 'ANY';
export type AclPermissionType = 'ALLOW' | 'DENY' | 'ANY';

export interface Acl {
  resourceType: AclResourceType;
  resourceName: string;
  patternType: AclPatternType;
  principal: string;
  host: string;
  operation: AclOperation;
  permissionType: AclPermissionType;
}

export interface AclQuery {
  resourceType?: AclResourceType;
  resourceName?: string;
  principal?: string;
}

export type QuotaEntityType = 'user' | 'client-id' | 'ip';

export interface QuotaValues {
  producer_byte_rate?: number | null;
  consumer_byte_rate?: number | null;
  request_percentage?: number | null;
  [key: string]: number | null | undefined;
}

export interface Quota {
  entityType: QuotaEntityType;
  entityName: string | null;
  quotas: QuotaValues;
}

export interface ScramUser {
  name: string;
  mechanisms: { mechanism: string; iterations: number }[];
}

export interface CreateScramUserRequest {
  name: string;
  password: string;
  mechanism: string;
  iterations?: number;
}

export interface ReplicationFlow {
  connector: string;
  connectCluster?: string;
  sourceCluster: string;
  targetCluster: string;
  topics: string[];
  state: string;
  lag: number | null;
}

/* ------------------------------ schema registry --------------------------- */

export type SchemaType = 'AVRO' | 'PROTOBUF' | 'JSON';
export type Compatibility =
  | 'BACKWARD'
  | 'BACKWARD_TRANSITIVE'
  | 'FORWARD'
  | 'FORWARD_TRANSITIVE'
  | 'FULL'
  | 'FULL_TRANSITIVE'
  | 'NONE';

export interface SchemaSubjectSummary {
  subject: string;
  latestVersion: number;
  schemaType: SchemaType;
  compatibility: Compatibility | null;
  versionsCount: number;
  topic?: string | null;
}

export interface SchemaReference {
  name: string;
  subject: string;
  version: number;
}

export interface SchemaVersion {
  version: number;
  id: number;
  schemaType: SchemaType;
  schema: string;
  references: SchemaReference[];
  createdAt?: string | null;
}

export interface SchemaSubjectDetail {
  subject: string;
  compatibility: Compatibility | null;
  versions: SchemaVersion[];
}

export interface RegisterSchemaRequest {
  schema: string;
  schemaType: SchemaType;
  references?: SchemaReference[];
  normalize?: boolean;
}

export interface CompatibilityCheckResponse {
  isCompatible: boolean;
  messages: string[];
}

export interface SchemaDiff {
  from: number;
  to: number;
  unifiedDiff: string;
}

export interface SchemaRegistryInfo {
  type: string;
  url: string;
  mode: string | null;
  version: string | null;
}

/* -------------------------------- connect --------------------------------- */

export interface ConnectCluster {
  name: string;
  url: string;
  version: string | null;
  commit: string | null;
  kafkaClusterId: string | null;
  status: 'online' | 'offline';
  connectorCount: number;
  runningTasks: number;
  failedTasks: number;
}

export type ConnectorState =
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'FAILED'
  | 'UNASSIGNED'
  | 'RESTARTING'
  | string;

export interface ConnectorTask {
  id: number;
  state: ConnectorState;
  workerId: string | null;
  trace: string | null;
}

export interface Connector {
  name: string;
  type: 'source' | 'sink';
  connectorClass: string;
  state: ConnectorState;
  workerId: string | null;
  tasks: ConnectorTask[];
  topics: string[];
  config: Record<string, string>;
}

export interface CreateConnectorRequest {
  name: string;
  config: Record<string, string>;
}

export interface ConnectorPlugin {
  class: string;
  type: string;
  version: string | null;
}

export interface ConnectorConfigDefinition {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  importance: string;
  documentation: string | null;
  group: string | null;
  dependents: string[];
}

export interface ConnectorConfigValue {
  value: string | null;
  recommendedValues: string[];
  errors: string[];
  visible: boolean;
}

export interface ConnectorValidationResult {
  name: string;
  errorCount: number;
  groups: string[];
  configs: { definition: ConnectorConfigDefinition; value: ConnectorConfigValue }[];
}

export interface ConnectorOffsets {
  offsets: { partition: Record<string, unknown>; offset: Record<string, unknown> }[];
}

/* --------------------------------- ksqlDB --------------------------------- */

export interface KsqlCluster {
  name: string;
  url: string;
  version: string | null;
  serverStatus: string | null;
  ksqlServiceId: string | null;
}

export interface KsqlQueryRequest {
  sql: string;
  properties?: Record<string, string>;
}

export interface KsqlHeaderEvent {
  columnNames: string[];
  columnTypes: string[];
  queryId: string | null;
}

export interface KsqlRowEvent {
  values: unknown[];
}

export interface KsqlStream {
  name: string;
  topic: string;
  keyFormat: string;
  valueFormat: string;
  isWindowed?: boolean;
}

export interface KsqlTable extends KsqlStream {
  isWindowed?: boolean;
}

export interface KsqlQueryInfo {
  id: string;
  queryString: string;
  sinks: string[];
  sinkKafkaTopics: string[];
  state: string | null;
  statusCount?: Record<string, number>;
}

export interface KsqlHistoryEntry {
  id: string | number;
  sql: string;
  user: string | null;
  ts: string;
  saved: boolean;
}

/* ---------------------------------- flink --------------------------------- */

export interface FlinkCluster {
  name: string;
  url: string;
  version: string | null;
  status: string;
  taskmanagers: number;
  slotsTotal: number;
  slotsAvailable: number;
  jobsRunning: number;
  jobsFinished: number;
  jobsCancelled: number;
  jobsFailed: number;
}

export interface FlinkTaskCounts {
  total: number;
  running: number;
  finished: number;
  canceling: number;
  canceled: number;
  failed: number;
  created: number;
  scheduled: number;
  deploying: number;
  reconciling: number;
  initializing: number;
}

export interface FlinkJob {
  jid: string;
  name: string;
  state: string;
  startTime: number;
  endTime: number;
  duration: number;
  tasks: FlinkTaskCounts;
}

export interface FlinkVertex {
  id: string;
  name: string;
  parallelism: number;
  status: string;
  metrics?: Record<string, number | string>;
}

export interface FlinkJobDetail extends FlinkJob {
  vertices: FlinkVertex[];
  plan?: unknown;
}

export interface FlinkCheckpoint {
  id: number;
  status: string;
  triggerTimestamp: number;
  latestAckTimestamp: number;
  stateSize: number;
  endToEndDuration: number;
}

export interface FlinkCheckpoints {
  counts: Record<string, number>;
  latest: Record<string, FlinkCheckpoint | null>;
  history: FlinkCheckpoint[];
}

export interface FlinkException {
  exceptionName?: string;
  stacktrace: string;
  timestamp: number;
  taskName?: string;
  location?: string;
}

export interface FlinkExceptions {
  rootException: string | null;
  timestamp: number | null;
  exceptionHistory?: { entries: FlinkException[] };
}

export interface FlinkTaskManager {
  id: string;
  path: string;
  dataPort: number;
  slotsNumber: number;
  freeSlots: number;
  totalResource?: Record<string, number>;
  hardware?: Record<string, number>;
}

export interface FlinkJar {
  id: string;
  name: string;
  uploaded: number;
  entry: { name: string; description: string | null }[];
}

export interface FlinkSavepointTrigger {
  'request-id': string;
}

export interface UnsupportedResponse {
  supported: false;
  reason?: string;
}

/* --------------------------------- metrics -------------------------------- */

export interface MetricsStatus {
  configured: boolean;
  url: string | null;
  reachable: boolean;
  buildInfo: Record<string, string> | null;
  targets: { job: string; health: string; lastScrape: string }[];
}

export interface MetricCatalogEntry {
  name: string;
  help: string | null;
  type?: string;
}

export type PanelType = 'timeseries' | 'stat' | 'gauge' | 'table' | 'bar' | 'heatmap';

export interface DashboardPanel {
  id: string;
  title: string;
  type: PanelType;
  unit: string;
  queries: { expr: string; legend: string }[];
  thresholds?: { value: number; color: string }[];
}

export interface DashboardRow {
  title: string;
  panels: DashboardPanel[];
}

export interface DashboardSummary {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  builtin: boolean;
}

export interface Dashboard extends DashboardSummary {
  variables: { name: string; query: string }[];
  rows: DashboardRow[];
}

export interface DashboardData {
  panels: Record<string, SeriesResponse>;
}

export interface PromInstantResult {
  resultType: string;
  result: { metric: Record<string, string>; value: [number, string] }[];
}

/* --------------------------------- lineage -------------------------------- */

export type LineageNodeType =
  | 'topic'
  | 'connector'
  | 'flinkJob'
  | 'ksqlQuery'
  | 'consumerGroup'
  | 'producer'
  | 'dataset'
  | 'job'
  | 'schema';

export interface LineageNode {
  id: string;
  type: LineageNodeType;
  label: string;
  namespace: string | null;
  status: string | null;
  meta: Record<string, unknown>;
  clusterId: string | null;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: 'produces' | 'consumes' | 'transforms';
  meta?: Record<string, unknown>;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface LineageNodeDetail extends LineageNode {
  latestRuns?: { id: string; state: string; startedAt: string; endedAt: string | null }[];
  schema?: unknown;
  facets?: Record<string, unknown>;
}

/* ---------------------------------- alerts -------------------------------- */

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertComponent =
  | 'cluster'
  | 'broker'
  | 'topic'
  | 'consumerGroup'
  | 'connector'
  | 'ksqlQuery'
  | 'flinkJob'
  | 'schemaRegistry'
  | 'custom';
export type AlertCondition = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';

export interface AlertTrigger {
  id: string;
  name: string;
  clusterId: string | null;
  component: AlertComponent;
  target: { name?: string; regex?: string };
  metric: string;
  condition: AlertCondition;
  value: number;
  bufferSeconds: number;
  severity: AlertSeverity;
  enabled: boolean;
  actionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type AlertActionType = 'email' | 'slack' | 'pagerduty' | 'webhook' | 'teams';

export interface AlertAction {
  id: string;
  name: string;
  type: AlertActionType;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface AlertNotification {
  actionId: string;
  status: string;
  error: string | null;
}

export interface AlertHistoryEntry {
  id: string;
  triggerId: string;
  triggerName: string;
  component: AlertComponent;
  target: string | null;
  clusterId: string | null;
  severity: AlertSeverity;
  status: 'firing' | 'resolved';
  value: number;
  threshold: number;
  firedAt: string;
  resolvedAt: string | null;
  notifications: AlertNotification[];
}

export interface AlertSummary {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byCluster?: Record<string, number>;
}

export interface AlertMetricCatalog {
  [component: string]: { name: string; unit?: string; description?: string }[];
}
