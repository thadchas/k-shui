import { useNavigate } from 'react-router';
import { AlertTriangle, Boxes, Server } from 'lucide-react';
import { useClusters } from '@/api/hooks/clusters';
import type { ClusterSummary } from '@/api/types';
import { CHART_COLORS } from '@/lib/charts';
import { formatBytesPerSec, formatCompact } from '@/lib/format';
import { FEATURE_LABELS } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={cn(
          'font-mono text-lg font-semibold tabular-nums',
          tone === 'warning' && 'text-[var(--warning)]',
          tone === 'danger' && 'text-[var(--danger)]',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FeatureChips({ features }: { features: ClusterSummary['features'] }) {
  const entries = Object.entries(features ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, enabled]) => (
        <Badge
          key={key}
          variant={enabled ? 'default' : 'secondary'}
          size="sm"
          className={cn(!enabled && 'opacity-60')}
        >
          {FEATURE_LABELS[key] ?? key}
        </Badge>
      ))}
    </div>
  );
}

function ClusterCard({ cluster, onOpen }: { cluster: ClusterSummary; onOpen: () => void }) {
  const brokersDown = cluster.brokerCount - cluster.onlineBrokers;
  const hasIssue =
    cluster.underReplicatedPartitions > 0 || cluster.offlinePartitions > 0 || brokersDown > 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer p-5 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{cluster.name}</h3>
            {hasIssue ? (
              <AlertTriangle className="size-3.5 shrink-0 text-[var(--warning)]" />
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-2xs text-[var(--muted)]">
            {cluster.id}
            {cluster.version ? ` · Kafka ${cluster.version}` : ''}
          </p>
        </div>
        <StatusPill status={cluster.status} />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
        <Metric
          label="Brokers"
          value={`${cluster.onlineBrokers}/${cluster.brokerCount}`}
          tone={brokersDown > 0 ? 'danger' : 'default'}
        />
        <Metric label="Topics" value={formatCompact(cluster.topicCount)} />
        <Metric label="Partitions" value={formatCompact(cluster.partitionCount)} />
        <Metric
          label="URP"
          value={formatCompact(cluster.underReplicatedPartitions)}
          tone={cluster.underReplicatedPartitions > 0 ? 'warning' : 'default'}
        />
        <Metric
          label="Offline"
          value={formatCompact(cluster.offlinePartitions)}
          tone={cluster.offlinePartitions > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">Bytes in</p>
          <p className="font-mono text-sm tabular-nums" style={{ color: CHART_COLORS[0] }}>
            {formatBytesPerSec(cluster.bytesInPerSec)}
          </p>
        </div>
        <div>
          <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">Bytes out</p>
          <p className="font-mono text-sm tabular-nums" style={{ color: CHART_COLORS[1] }}>
            {formatBytesPerSec(cluster.bytesOutPerSec)}
          </p>
        </div>
      </div>

      <FeatureChips features={cluster.features} />
    </Card>
  );
}

export function ClustersPage() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useClusters();

  return (
    <div>
      <PageHeader
        title="Clusters"
        description="Every Kafka cluster configured in k-shui.yaml."
        meta={data ? <Badge variant="secondary">{data.length}</Badge> : null}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="No clusters configured"
            description="Add a cluster to k-shui.yaml (or set KSHUI_BOOTSTRAP_SERVERS) and restart the server."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              onOpen={() => void navigate(`/c/${cluster.id}/overview`)}
            />
          ))}
        </div>
      )}

      {data && data.length > 0 ? (
        <p className="mt-6 flex items-center gap-1.5 text-2xs text-[var(--muted)]">
          <Server className="size-3" />
          Click a cluster to open its overview.
        </p>
      ) : null}
    </div>
  );
}

export default ClustersPage;
