import { Link } from 'react-router';
import { ArrowUpRight, CircleCheck, CircleX, Cpu, Server, Terminal, Workflow } from 'lucide-react';
import { useFlinkClusterList } from '@/api/hooks/flink';
import type { FlinkClusterInfo } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { UsageBar } from './components/TaskStatusBar';

function ClusterCardSkeleton() {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className="truncate font-mono text-lg font-semibold tabular-nums"
        style={{ color: tone ?? 'var(--foreground)' }}
      >
        {value}
      </p>
    </div>
  );
}

function FlinkClusterCard({ cluster, item }: { cluster: string; item: FlinkClusterInfo }) {
  const base = `/c/${cluster}/flink/${encodeURIComponent(item.name)}`;
  const slotsUsed = Math.max(0, (item.slotsTotal ?? 0) - (item.slotsAvailable ?? 0));

  return (
    <Card className="flex flex-col gap-4 p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Workflow className="size-4 shrink-0 text-[var(--primary)]" />
            <Link
              to={base}
              className="truncate text-base font-semibold text-[var(--foreground)] hover:text-[var(--primary)]"
            >
              {item.name}
            </Link>
          </div>
          <p className="mt-0.5 truncate font-mono text-2xs text-[var(--muted)]">{item.url}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill status={item.status} />
          {item.version ? (
            <Badge variant="secondary" size="sm">
              v{item.version}
            </Badge>
          ) : null}
        </div>
      </div>

      <UsageBar
        label="Task slots"
        used={slotsUsed}
        total={item.slotsTotal ?? 0}
        format={(v) => String(v)}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Running" value={formatCompact(item.jobsRunning)} tone="var(--success)" />
        <Metric
          label="Failed"
          value={formatCompact(item.jobsFailed)}
          tone={item.jobsFailed > 0 ? 'var(--danger)' : undefined}
        />
        <Metric label="Finished" value={formatCompact(item.jobsFinished)} />
        <Metric label="TaskManagers" value={formatCompact(item.taskmanagers)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
        <Button asChild size="sm" variant="outline">
          <Link to={base}>
            <Workflow /> Jobs
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`${base}/taskmanagers`}>
            <Server /> Task managers
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`${base}/sql`}>
            <Terminal /> SQL
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`${base}/jars`}>
            <Cpu /> Jars
          </Link>
        </Button>
        <span className="ml-auto inline-flex items-center gap-1 text-2xs text-[var(--muted)]">
          {item.sqlGateway ? (
            <>
              <CircleCheck className="size-3 text-[var(--success)]" /> SQL gateway
            </>
          ) : (
            <>
              <CircleX className="size-3" /> No SQL gateway
            </>
          )}
        </span>
      </div>
    </Card>
  );
}

export function FlinkPage() {
  const cluster = useClusterId();
  const { data, isLoading, error, refetch, isFetching } = useFlinkClusterList(cluster);

  const totalJobs = (data ?? []).reduce((a, c) => a + (c.jobsRunning ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Flink"
        description="Session clusters, jobs, task managers and SQL."
        meta={
          data ? (
            <Badge variant="secondary">
              {data.length} cluster{data.length === 1 ? '' : 's'} · {totalJobs} running
            </Badge>
          ) : null
        }
        actions={<RefreshPicker onRefresh={() => void refetch()} refreshing={isFetching} />}
      />

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <ClusterCardSkeleton />
          <ClusterCardSkeleton />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Workflow}
            title="No Flink clusters configured"
            description={
              <>
                Add a <span className="font-mono">flink:</span> entry to this cluster in
                <span className="font-mono"> k-shui.yaml</span> to manage jobs, task managers and
                the SQL gateway from here.
              </>
            }
            action={
              <Button asChild variant="outline">
                <Link to={`/c/${cluster}/settings`}>
                  Cluster settings <ArrowUpRight />
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.map((item) => (
            <FlinkClusterCard key={item.name} cluster={cluster} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export default FlinkPage;
