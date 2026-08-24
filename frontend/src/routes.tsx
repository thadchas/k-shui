import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { routerBasename } from '@/lib/utils';
import { AppShell } from '@/layouts/AppShell';
import { NotFound } from '@/layouts/NotFound';

import { useUiStore } from '@/stores/ui';
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

import { SchemasPage } from '@/pages/schemas/SchemasPage';
import { NewSchemaPage } from '@/pages/schemas/NewSchemaPage';
import { SchemaDetailPage } from '@/pages/schemas/SchemaDetailPage';
import { ConnectPage } from '@/pages/connect/ConnectPage';
import { ConnectClusterPage } from '@/pages/connect/ConnectClusterPage';
import { NewConnectorPage } from '@/pages/connect/NewConnectorPage';
import { ConnectorDetailPage } from '@/pages/connect/ConnectorDetailPage';
import { ConnectPluginsPage } from '@/pages/connect/ConnectPluginsPage';
import { KsqlPage } from '@/pages/ksql/KsqlPage';
import { FlinkPage } from '@/pages/flink/FlinkPage';
import { FlinkClusterPage } from '@/pages/flink/FlinkClusterPage';
import { FlinkJobPage } from '@/pages/flink/FlinkJobPage';
import { FlinkTaskManagersPage } from '@/pages/flink/FlinkTaskManagersPage';
import { FlinkSqlPage } from '@/pages/flink/FlinkSqlPage';
import { FlinkJarsPage } from '@/pages/flink/FlinkJarsPage';
import { ReplicationPage } from '@/pages/replication/ReplicationPage';
import { MetricsPage } from '@/pages/metrics/MetricsPage';
import { MetricsDashboardPage } from '@/pages/metrics/MetricsDashboardPage';
import { MetricsExplorePage } from '@/pages/metrics/MetricsExplorePage';
import { LineagePage } from '@/pages/lineage/LineagePage';
import { AlertsPage } from '@/pages/alerts/AlertsPage';
import { NewAlertTriggerPage } from '@/pages/alerts/AlertTriggerFormPage';
import { AlertTriggerDetailPage } from '@/pages/alerts/AlertTriggerFormPage';
import { NewAlertActionPage } from '@/pages/alerts/AlertActionFormPage';

const decode = (v: string | undefined) => (v ? decodeURIComponent(v) : '');

/** `/` → last visited cluster's overview when one is remembered, else the cluster list. */
function IndexRedirect() {
  const lastClusterId = useUiStore((s) => s.lastClusterId);
  return (
    <Navigate
      to={lastClusterId ? `/c/${encodeURIComponent(lastClusterId)}/overview` : '/clusters'}
      replace
    />
  );
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <IndexRedirect /> },
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
