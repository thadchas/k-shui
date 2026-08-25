import { Crown } from 'lucide-react';
import { useClusterConfigs, useKRaftQuorum, useUpdateClusterConfigs } from '@/api/hooks/clusters';
import { useClusterId } from '@/hooks/useClusterId';
import { usePermissions } from '@/hooks/usePermissions';
import { formatNumber, formatRelative } from '@/lib/format';
import { ConfigTable } from '@/components/ConfigTable';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast, toastError } from '@/components/ui/toast';

export function ClusterSettingsPage() {
  const cluster = useClusterId();
  const configs = useClusterConfigs(cluster);
  const updateConfigs = useUpdateClusterConfigs(cluster);
  const quorum = useKRaftQuorum(cluster);
  const { canEdit } = usePermissions();

  const replicas = [
    ...(quorum.data?.voters ?? []).map((v) => ({ ...v, role: 'voter' as const })),
    ...(quorum.data?.observers ?? []).map((v) => ({ ...v, role: 'observer' as const })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cluster settings"
        description="Dynamic cluster-level configuration and metadata quorum."
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Dynamic configs</h2>
        <ConfigTable
          configs={configs.data}
          loading={configs.isLoading}
          error={configs.error}
          onRetry={() => void configs.refetch()}
          saving={updateConfigs.isPending}
          readOnly={!canEdit}
          onSave={async (changes) => {
            try {
              await updateConfigs.mutateAsync({ configs: changes });
              toast.success('Cluster configs updated');
            } catch (e) {
              toastError('Failed to update configs', e);
              throw e;
            }
          }}
        />
      </section>

      <Card>
        <CardToolbarHeader
          title="KRaft quorum"
          description="Metadata log voters and observers"
          actions={
            quorum.data?.highWatermark !== undefined && quorum.data?.highWatermark !== null ? (
              <Badge variant="info">HWM {formatNumber(quorum.data.highWatermark)}</Badge>
            ) : null
          }
        />
        <CardContent>
          {quorum.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : quorum.error || replicas.length === 0 ? (
            <EmptyState
              compact
              icon={Crown}
              title="Quorum information unavailable"
              description="This cluster is not running in KRaft mode, or the broker does not expose quorum metadata."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Node</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead numeric>Log end offset</TableHead>
                    <TableHead numeric>Lag</TableHead>
                    <TableHead>Last fetch</TableHead>
                    <TableHead>Last caught up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replicas.map((replica) => (
                    <TableRow key={`${replica.role}-${replica.id}`}>
                      <TableCell>
                        <span className="font-mono tabular-nums">{replica.id}</span>
                        {replica.id === quorum.data?.leaderId ? (
                          <Badge variant="default" size="sm" className="ml-2">
                            leader
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={replica.role === 'voter' ? 'info' : 'secondary'} size="sm">
                          {replica.role}
                        </Badge>
                      </TableCell>
                      <TableCell numeric>{formatNumber(replica.logEndOffset)}</TableCell>
                      <TableCell
                        numeric
                        className={replica.lag > 0 ? 'text-[var(--warning)]' : undefined}
                      >
                        {formatNumber(replica.lag)}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--muted)]">
                        {replica.lastFetchTs ? formatRelative(replica.lastFetchTs) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--muted)]">
                        {replica.lastCaughtUpTs ? formatRelative(replica.lastCaughtUpTs) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ClusterSettingsPage;
