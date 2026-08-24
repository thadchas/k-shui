import { Link } from 'react-router';
import { Cable, ExternalLink, Puzzle } from 'lucide-react';
import { useConnectClusters } from '@/api/hooks/connect';
import type { ConnectCluster } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip } from '@/components/ui/tooltip';

export function ConnectPage() {
  const cluster = useClusterId();
  const { data, isLoading, error, refetch } = useConnectClusters(cluster);

  return (
    <div>
      <PageHeader
        title="Kafka Connect"
        description="Connect clusters configured for this Kafka cluster, with connector and task health."
        meta={data ? <Badge variant="secondary">{data.length}</Badge> : null}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Cable}
            title="No Connect clusters configured"
            description={
              <>
                Add a <span className="font-mono">connect</span> entry to this cluster in{' '}
                <span className="font-mono">k-shui.yaml</span> to manage connectors from here.
              </>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((connect) => (
            <ConnectClusterCard key={connect.name} cluster={cluster} connect={connect} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectClusterCard({ cluster, connect }: { cluster: string; connect: ConnectCluster }) {
  const base = `/c/${cluster}/connect/${encodeURIComponent(connect.name)}`;
  return (
    <Card className="flex flex-col transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="truncate">
            <Link to={base} className="hover:text-[var(--primary)]">
              {connect.name}
            </Link>
          </CardTitle>
          <Tooltip content={connect.url}>
            <span className="block truncate font-mono text-2xs text-[var(--muted)]">
              {connect.url}
            </span>
          </Tooltip>
        </div>
        <StatusPill status={connect.status} />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Connectors" value={formatCompact(connect.connectorCount)} />
          <Metric
            label="Running tasks"
            value={formatCompact(connect.runningTasks)}
            tone={connect.runningTasks > 0 ? 'success' : undefined}
          />
          <Metric
            label="Failed tasks"
            value={formatCompact(connect.failedTasks)}
            tone={connect.failedTasks > 0 ? 'danger' : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-[var(--muted)]">
          {connect.version ? <Badge variant="secondary">v{connect.version}</Badge> : null}
          {connect.commit ? (
            <Tooltip content={`Commit ${connect.commit}`}>
              <span className="font-mono">{connect.commit.slice(0, 7)}</span>
            </Tooltip>
          ) : null}
          {connect.kafkaClusterId ? (
            <Tooltip content={`Kafka cluster id ${connect.kafkaClusterId}`}>
              <span className="truncate font-mono">{connect.kafkaClusterId}</span>
            </Tooltip>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={base}>
              <Cable /> Connectors
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`${base}/plugins`}>
              <Puzzle /> Plugins
            </Link>
          </Button>
          <Button asChild size="icon-sm" variant="ghost" className="ml-auto">
            <a
              href={connect.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open Connect REST API"
            >
              <ExternalLink />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={
          tone === 'danger'
            ? 'text-lg font-semibold tabular-nums text-[var(--danger)]'
            : tone === 'success'
              ? 'text-lg font-semibold tabular-nums text-[var(--success)]'
              : 'text-lg font-semibold tabular-nums'
        }
      >
        {value}
      </p>
    </div>
  );
}

export default ConnectPage;
