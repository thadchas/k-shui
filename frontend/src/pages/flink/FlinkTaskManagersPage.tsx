import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useFlinkOverview, useFlinkTaskManagerList } from '@/api/hooks/flink';
import { useClusterId } from '@/hooks/useClusterId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { TaskManagersTable } from './components/TaskManagersTable';

export function FlinkTaskManagersPage() {
  const cluster = useClusterId();
  const { fc = '' } = useParams<{ fc: string }>();
  const list = useFlinkTaskManagerList(cluster, fc);
  const overview = useFlinkOverview(cluster, fc);
  const base = `/c/${cluster}/flink/${encodeURIComponent(fc)}`;

  const slotsUsed = Math.max(
    0,
    (overview.data?.slotsTotal ?? 0) - (overview.data?.slotsAvailable ?? 0),
  );

  return (
    <div>
      <PageHeader
        title="Task managers"
        description={`Workers registered with ${fc}`}
        meta={
          list.data ? (
            <Badge variant="secondary">
              {list.data.length} node{list.data.length === 1 ? '' : 's'} · {slotsUsed}/
              {overview.data?.slotsTotal ?? 0} slots
            </Badge>
          ) : null
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={base}>
                <ArrowLeft /> Cluster
              </Link>
            </Button>
            <RefreshPicker onRefresh={() => void list.refetch()} refreshing={list.isFetching} />
          </>
        }
      />
      <TaskManagersTable cluster={cluster} flinkCluster={fc} />
    </div>
  );
}

export default FlinkTaskManagersPage;
