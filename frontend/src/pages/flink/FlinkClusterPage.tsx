import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Activity, Cpu, Server, Terminal, Workflow } from 'lucide-react';
import { useFlinkClusterList, useFlinkJobs, useFlinkOverview } from '@/api/hooks/flink';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact } from '@/lib/format';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobManagerTab } from './components/JobManagerTab';
import { JobsTable } from './components/JobsTable';
import { TaskManagersTable } from './components/TaskManagersTable';
import { TaskStatusLegend, UsageBar } from './components/TaskStatusBar';

const TABS = ['jobs', 'taskmanagers', 'jobmanager'] as const;

export function FlinkClusterPage() {
  const cluster = useClusterId();
  const { fc = '' } = useParams<{ fc: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') ?? 'jobs';
  const tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : 'jobs';

  const clusters = useFlinkClusterList(cluster);
  const overview = useFlinkOverview(cluster, fc);
  const jobs = useFlinkJobs(cluster, fc);

  const info = clusters.data?.find((c) => c.name === fc);
  const base = `/c/${cluster}/flink/${encodeURIComponent(fc)}`;
  const ov = overview.data;
  const slotsUsed = Math.max(0, (ov?.slotsTotal ?? 0) - (ov?.slotsAvailable ?? 0));

  if (overview.error && clusters.error) {
    return (
      <div>
        <PageHeader title={fc} description="Flink session cluster" />
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={fc}
        description={info?.url ?? 'Flink session cluster'}
        meta={
          <div className="flex items-center gap-2">
            {info ? <StatusPill status={info.status} /> : null}
            {(ov?.flinkVersion ?? info?.version) ? (
              <Badge variant="secondary">v{ov?.flinkVersion ?? info?.version}</Badge>
            ) : null}
          </div>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={`${base}/sql`}>
                <Terminal /> SQL
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`${base}/jars`}>
                <Cpu /> Jars
              </Link>
            </Button>
            <RefreshPicker
              onRefresh={() => {
                void overview.refetch();
                void jobs.refetch();
              }}
              refreshing={overview.isFetching || jobs.isFetching}
            />
          </>
        }
      />

      <StatTileRow columns={5}>
        <StatTile
          label="Jobs running"
          value={formatCompact(ov?.jobsRunning)}
          tone={(ov?.jobsRunning ?? 0) > 0 ? 'success' : 'muted'}
          icon={Workflow}
          loading={overview.isLoading}
        />
        <StatTile
          label="Jobs failed"
          value={formatCompact(ov?.jobsFailed)}
          tone={(ov?.jobsFailed ?? 0) > 0 ? 'danger' : 'success'}
          icon={Activity}
          loading={overview.isLoading}
        />
        <StatTile
          label="Jobs finished"
          value={formatCompact(ov?.jobsFinished)}
          icon={Workflow}
          loading={overview.isLoading}
        />
        <StatTile
          label="Task managers"
          value={formatCompact(ov?.taskmanagers)}
          icon={Server}
          loading={overview.isLoading}
          onClick={() => void navigate(`${base}/taskmanagers`)}
        />
        <StatTile
          label="Slots used"
          value={`${slotsUsed}/${ov?.slotsTotal ?? 0}`}
          tone={
            (ov?.slotsTotal ?? 0) > 0 && slotsUsed >= (ov?.slotsTotal ?? 0) ? 'warning' : 'muted'
          }
          icon={Cpu}
          loading={overview.isLoading}
        />
      </StatTileRow>

      <Card>
        <CardToolbarHeader
          title="Slot allocation"
          description="Available parallelism across all task managers"
        />
        <CardContent>
          <UsageBar used={slotsUsed} total={ov?.slotsTotal ?? 0} label="Task slots" />
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'jobs' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="taskmanagers">Task managers</TabsTrigger>
          <TabsTrigger value="jobmanager">Job manager</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-3">
          <JobsTable
            cluster={cluster}
            flinkCluster={fc}
            jobs={jobs.data}
            loading={jobs.isLoading}
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
          />
          <TaskStatusLegend />
        </TabsContent>

        <TabsContent value="taskmanagers">
          <TaskManagersTable cluster={cluster} flinkCluster={fc} />
        </TabsContent>

        <TabsContent value="jobmanager">
          <JobManagerTab cluster={cluster} flinkCluster={fc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default FlinkClusterPage;
