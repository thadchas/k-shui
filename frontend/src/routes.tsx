import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { routerBasename } from '@/lib/utils';
import { AppShell } from '@/layouts/AppShell';
import { NotFound } from '@/layouts/NotFound';

/* fully implemented */
import { ClustersPage } from '@/pages/clusters/ClustersPage';
import { ClusterOverviewPage } from '@/pages/overview/ClusterOverviewPage';
import { BrokersPage } from '@/pages/brokers/BrokersPage';
import { BrokerDetailPage } from '@/pages/brokers/BrokerDetailPage';
import { TopicsPage } from '@/pages/topics/TopicsPage';
import { NewTopicPage } from '@/pages/topics/NewTopicPage';
import { TopicDetailPage } from '@/pages/topics/TopicDetailPage';
import { ConsumersPage } from '@/pages/consumers/ConsumersPage';
import { ConsumerGroupDetailPage } from '@/pages/consumers/ConsumerGroupDetailPage';
import { ShareGroupsPage } from '@/pages/consumers/ShareGroupsPage';
import { SecurityPage } from '@/pages/security/SecurityPage';
import { ClusterSettingsPage } from '@/pages/settings/ClusterSettingsPage';
import { AppSettingsPage } from '@/pages/settings/AppSettingsPage';
import { AuditPage } from '@/pages/audit/AuditPage';
import { LoginPage } from '@/pages/auth/LoginPage';

/* placeholders — replaced by later agents (see src/pages/_placeholder) */
import { SchemasPage } from '@/pages/_placeholder/SchemasPage';
import { NewSchemaPage } from '@/pages/_placeholder/NewSchemaPage';
import { SchemaDetailPage } from '@/pages/_placeholder/SchemaDetailPage';
import { ConnectPage } from '@/pages/_placeholder/ConnectPage';
import { ConnectClusterPage } from '@/pages/_placeholder/ConnectClusterPage';
import { NewConnectorPage } from '@/pages/_placeholder/NewConnectorPage';
import { ConnectorDetailPage } from '@/pages/_placeholder/ConnectorDetailPage';
import { ConnectPluginsPage } from '@/pages/_placeholder/ConnectPluginsPage';
import { KsqlPage } from '@/pages/_placeholder/KsqlPage';
import { FlinkPage } from '@/pages/_placeholder/FlinkPage';
import { FlinkClusterPage } from '@/pages/_placeholder/FlinkClusterPage';
import { FlinkJobPage } from '@/pages/_placeholder/FlinkJobPage';
import { FlinkTaskManagersPage } from '@/pages/_placeholder/FlinkTaskManagersPage';
import { FlinkSqlPage } from '@/pages/_placeholder/FlinkSqlPage';
import { FlinkJarsPage } from '@/pages/_placeholder/FlinkJarsPage';
import { ReplicationPage } from '@/pages/_placeholder/ReplicationPage';
import { MetricsPage } from '@/pages/_placeholder/MetricsPage';
import { MetricsDashboardPage } from '@/pages/_placeholder/MetricsDashboardPage';
import { MetricsExplorePage } from '@/pages/_placeholder/MetricsExplorePage';
import { LineagePage } from '@/pages/_placeholder/LineagePage';
import { AlertsPage } from '@/pages/_placeholder/AlertsPage';
import { NewAlertTriggerPage } from '@/pages/_placeholder/NewAlertTriggerPage';
import { AlertTriggerDetailPage } from '@/pages/_placeholder/AlertTriggerDetailPage';
import { NewAlertActionPage } from '@/pages/_placeholder/NewAlertActionPage';

const decode = (v: string | undefined) => (v ? decodeURIComponent(v) : '');

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <Navigate to="/clusters" replace /> },
      { path: 'clusters', element: <ClustersPage />, handle: { crumb: 'Clusters' } },
      { path: 'alerts', element: <AlertsPage />, handle: { crumb: 'Alerts' } },
      {
        path: 'alerts/triggers/new',
        element: <NewAlertTriggerPage />,
        handle: { crumb: 'New trigger' },
      },
      {
        path: 'alerts/triggers/:id',
        element: <AlertTriggerDetailPage />,
        handle: { crumb: 'Trigger' },
      },
      {
        path: 'alerts/actions/new',
        element: <NewAlertActionPage />,
        handle: { crumb: 'New action' },
      },
      { path: 'audit', element: <AuditPage />, handle: { crumb: 'Audit' } },
      { path: 'settings', element: <AppSettingsPage />, handle: { crumb: 'Settings' } },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/c/:cluster',
    element: <AppShell />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <Navigate to="overview" replace /> },
      { path: 'overview', element: <ClusterOverviewPage />, handle: { crumb: 'Overview' } },

      { path: 'brokers', element: <BrokersPage />, handle: { crumb: 'Brokers' } },
      {
        path: 'brokers/:brokerId',
        element: <BrokerDetailPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => `Broker ${p.brokerId ?? ''}` },
      },

      { path: 'topics', element: <TopicsPage />, handle: { crumb: 'Topics' } },
      { path: 'topics/new', element: <NewTopicPage />, handle: { crumb: 'New topic' } },
      {
        path: 'topics/:topic',
        element: <TopicDetailPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => decode(p.topic) },
      },

      { path: 'consumers', element: <ConsumersPage />, handle: { crumb: 'Consumers' } },
      {
        path: 'consumers/:group',
        element: <ConsumerGroupDetailPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => decode(p.group) },
      },
      { path: 'share-groups', element: <ShareGroupsPage />, handle: { crumb: 'Share groups' } },

      { path: 'schemas', element: <SchemasPage />, handle: { crumb: 'Schemas' } },
      { path: 'schemas/new', element: <NewSchemaPage />, handle: { crumb: 'New schema' } },
      {
        path: 'schemas/:subject',
        element: <SchemaDetailPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => decode(p.subject) },
      },

      { path: 'connect', element: <ConnectPage />, handle: { crumb: 'Connect' } },
      {
        path: 'connect/:kc',
        element: <ConnectClusterPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => p.kc ?? 'Connect' },
      },
      {
        path: 'connect/:kc/connectors/new',
        element: <NewConnectorPage />,
        handle: { crumb: 'New connector' },
      },
      {
        path: 'connect/:kc/connectors/:name',
        element: <ConnectorDetailPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => decode(p.name) },
      },
      {
        path: 'connect/:kc/plugins',
        element: <ConnectPluginsPage />,
        handle: { crumb: 'Plugins' },
      },

      { path: 'ksql', element: <KsqlPage />, handle: { crumb: 'ksqlDB' } },

      { path: 'flink', element: <FlinkPage />, handle: { crumb: 'Flink' } },
      {
        path: 'flink/:fc',
        element: <FlinkClusterPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => p.fc ?? 'Flink' },
      },
      {
        path: 'flink/:fc/jobs/:jid',
        element: <FlinkJobPage />,
        handle: {
          crumb: (p: Record<string, string | undefined>) => `Job ${p.jid?.slice(0, 8) ?? ''}`,
        },
      },
      {
        path: 'flink/:fc/taskmanagers',
        element: <FlinkTaskManagersPage />,
        handle: { crumb: 'Task managers' },
      },
      { path: 'flink/:fc/sql', element: <FlinkSqlPage />, handle: { crumb: 'SQL' } },
      { path: 'flink/:fc/jars', element: <FlinkJarsPage />, handle: { crumb: 'Jars' } },

      { path: 'replication', element: <ReplicationPage />, handle: { crumb: 'Replication' } },

      { path: 'metrics', element: <MetricsPage />, handle: { crumb: 'Metrics' } },
      { path: 'metrics/explore', element: <MetricsExplorePage />, handle: { crumb: 'Explore' } },
      {
        path: 'metrics/:dashboard',
        element: <MetricsDashboardPage />,
        handle: { crumb: (p: Record<string, string | undefined>) => p.dashboard ?? 'Dashboard' },
      },

      { path: 'lineage', element: <LineagePage />, handle: { crumb: 'Lineage' } },

      { path: 'security', element: <SecurityPage />, handle: { crumb: 'Security' } },
      { path: 'settings', element: <ClusterSettingsPage />, handle: { crumb: 'Settings' } },

      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: routerBasename() || undefined });
