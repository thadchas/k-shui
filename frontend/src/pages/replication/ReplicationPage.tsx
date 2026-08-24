import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Cable, Copy, Heart, Milestone, Repeat } from 'lucide-react';
import { useReplicationOverview } from '@/api/hooks/clusters';
import { useConnectClusters } from '@/api/hooks/connect';
import type { ReplicationFlow } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatCompact } from '@/lib/format';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip } from '@/components/ui/tooltip';
import {
  connectorStateTone,
  mirrorRole,
  type MirrorRole,
} from '../connect/components/connectUtils';

interface Flow {
  key: string;
  source: string;
  target: string;
  connectors: ReplicationFlow[];
  topics: string[];
  lag: number | null;
}

const ROLE_ICON: Record<Exclude<MirrorRole, null> | 'unknown', typeof Repeat> = {
  source: Copy,
  checkpoint: Milestone,
  heartbeat: Heart,
  replicator: Repeat,
  unknown: Cable,
};

const ROLE_LABEL: Record<Exclude<MirrorRole, null> | 'unknown', string> = {
  source: 'Source',
  checkpoint: 'Checkpoint',
  heartbeat: 'Heartbeat',
  replicator: 'Replicator',
  unknown: 'Connector',
};

export function ReplicationPage() {
  const cluster = useClusterId();
  const replication = useReplicationOverview(cluster);
  const connectClusters = useConnectClusters(cluster);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const flows = useMemo<Flow[]>(() => {
    const byPair = new Map<string, Flow>();
    for (const entry of replication.data?.flows ?? []) {
      const key = `${entry.sourceCluster}→${entry.targetCluster}`;
      const flow = byPair.get(key) ?? {
        key,
        source: entry.sourceCluster,
        target: entry.targetCluster,
        connectors: [],
        topics: [],
        lag: null,
      };
      flow.connectors.push(entry);
      for (const topic of entry.topics ?? []) {
        if (!flow.topics.includes(topic)) flow.topics.push(topic);
      }
      if (entry.lag !== null && entry.lag !== undefined) {
        flow.lag = Math.max(flow.lag ?? 0, entry.lag);
      }
      byPair.set(key, flow);
    }
    return Array.from(byPair.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [replication.data?.flows]);

  const defaultConnectCluster =
    replication.data?.connectClusters?.[0] ?? connectClusters.data?.[0]?.name ?? null;

  const totals = useMemo(() => {
    const connectors = replication.data?.flows ?? [];
    const running = connectors.filter((c) => (c.state ?? '').toUpperCase() === 'RUNNING').length;
    const failed = connectors.filter((c) => (c.state ?? '').toUpperCase() === 'FAILED').length;
    const topics = new Set<string>();
    for (const connector of connectors)
      for (const topic of connector.topics ?? []) topics.add(topic);
    return {
      flows: flows.length,
      connectors: connectors.length,
      running,
      failed,
      topics: topics.size,
    };
  }, [replication.data?.flows, flows.length]);

  const unsupported = replication.data && replication.data.supported === false;

  return (
    <div>
      <PageHeader
        title="Replication"
        description="MirrorMaker 2 and Replicator flows detected in the Connect clusters."
        meta={flows.length ? <Badge variant="secondary">{flows.length} flows</Badge> : null}
      />

      {replication.error ? (
        <ErrorState error={replication.error} onRetry={() => void replication.refetch()} />
      ) : replication.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-[var(--radius-card)]" />
          <Skeleton className="h-56 w-full rounded-[var(--radius-card)]" />
        </div>
      ) : unsupported ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Repeat}
            title="Replication is not available"
            description="This cluster has no Connect cluster configured, so MirrorMaker 2 connectors cannot be discovered."
          />
        </div>
      ) : flows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Repeat}
            title="No replication flows detected"
            description={
              <>
                No MirrorMaker 2 or Replicator connectors were found
                {replication.data?.connectClusters?.length
                  ? ` in ${replication.data.connectClusters.join(', ')}`
                  : ''}
                . Create a <span className="font-mono">MirrorSourceConnector</span> to start
                replicating topics between clusters.
              </>
            }
            action={
              defaultConnectCluster ? (
                <Button asChild variant="outline">
                  <Link
                    to={`/c/${cluster}/connect/${encodeURIComponent(defaultConnectCluster)}/connectors/new`}
                  >
                    <Cable /> New connector
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          <StatTileRow columns={4}>
            <StatTile label="Flows" value={totals.flows} />
            <StatTile label="Connectors" value={totals.connectors} />
            <StatTile
              label="Running"
              value={totals.running}
              tone={totals.running > 0 ? 'success' : 'muted'}
            />
            <StatTile
              label="Failed"
              value={totals.failed}
              tone={totals.failed > 0 ? 'danger' : 'muted'}
            />
          </StatTileRow>

          <div className="grid gap-4 xl:grid-cols-2">
            {flows.map((flow) => {
              const isExpanded = expanded[flow.key] ?? false;
              const visibleTopics = isExpanded ? flow.topics : flow.topics.slice(0, 12);
              return (
                <Card key={flow.key}>
                  <CardHeader className="gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <ClusterChip name={flow.source} label="source" />
                      <ArrowRight className="size-4 text-[var(--muted)]" />
                      <ClusterChip name={flow.target} label="target" />
                      {flow.lag !== null ? (
                        <Badge
                          variant={flow.lag > 0 ? 'warning' : 'success'}
                          className="ml-auto tabular-nums"
                        >
                          lag {formatCompact(flow.lag)}
                        </Badge>
                      ) : null}
                    </div>
                    <CardTitle className="text-xs font-medium text-[var(--muted)]">
                      {flow.topics.length} topic{flow.topics.length === 1 ? '' : 's'} ·{' '}
                      {flow.connectors.length} connector
                      {flow.connectors.length === 1 ? '' : 's'}
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      {flow.connectors.map((connector) => {
                        const role = mirrorRole(connector.connector) ?? 'unknown';
                        const Icon = ROLE_ICON[role];
                        const kc = connector.connectCluster ?? defaultConnectCluster;
                        return (
                          <div
                            key={connector.connector}
                            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                          >
                            <Icon className="size-3.5 shrink-0 text-[var(--primary)]" />
                            <span className="text-2xs font-medium uppercase tracking-wide text-[var(--muted)]">
                              {ROLE_LABEL[role]}
                            </span>
                            {kc ? (
                              <Link
                                to={`/c/${cluster}/connect/${encodeURIComponent(kc)}/connectors/${encodeURIComponent(connector.connector)}`}
                                className="min-w-0 flex-1 truncate font-mono text-2xs text-[var(--primary)] hover:underline"
                              >
                                {connector.connector}
                              </Link>
                            ) : (
                              <span className="min-w-0 flex-1 truncate font-mono text-2xs">
                                {connector.connector}
                              </span>
                            )}
                            <StatusPill
                              status={connector.state}
                              tone={connectorStateTone(connector.state)}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div>
                      <p className="mb-2 text-2xs uppercase tracking-wide text-[var(--muted)]">
                        Replicated topics
                      </p>
                      {flow.topics.length === 0 ? (
                        <p className="text-xs text-[var(--muted)]">
                          No topics reported yet — the connector may still be starting.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {visibleTopics.map((topic) => (
                            <Tooltip key={topic} content={topic}>
                              <Link to={`/c/${cluster}/topics/${encodeURIComponent(topic)}`}>
                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="max-w-56 truncate font-mono"
                                >
                                  {topic}
                                </Badge>
                              </Link>
                            </Tooltip>
                          ))}
                          {flow.topics.length > 12 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [flow.key]: !isExpanded }))
                              }
                            >
                              {isExpanded ? 'Show less' : `+${flow.topics.length - 12} more`}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterChip({ name, label }: { name: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="truncate font-mono text-[13px] font-medium">{name}</span>
    </span>
  );
}

export default ReplicationPage;
