import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  Database,
  Eraser,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  SplitSquareHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import {
  useAddPartitions,
  useDeleteTopic,
  usePurgeTopic,
  useTopic,
  useTopicConfigs,
  useTopicConsumers,
  useTopicMetrics,
  useTopicSchema,
  useUpdateTopicConfigs,
} from '@/api/hooks/topics';
import type { TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { pickSeries } from '@/lib/charts';
import { formatBytes, formatBytesPerSec, formatCompact, formatDuration } from '@/lib/format';
import { ConfigTable } from '@/components/ConfigTable';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { PartitionsTable } from '@/components/PartitionsTable';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import { MessagesTab } from './components/MessagesTab';

const TABS = [
  'overview',
  'messages',
  'partitions',
  'configs',
  'consumers',
  'schema',
  'metrics',
  'lineage',
];

export function TopicDetailPage() {
  const cluster = useClusterId();
  const { topic: topicParam = '' } = useParams<{ topic: string }>();
  const topic = decodeURIComponent(topicParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') ?? 'overview';
  const tab = TABS.includes(requestedTab) ? requestedTab : 'overview';

  const [range, setRange] = useState<TimeRange>('1h');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [partitionsOpen, setPartitionsOpen] = useState(false);
  const [newPartitions, setNewPartitions] = useState(1);

  const detail = useTopic(cluster, topic);
  const configs = useTopicConfigs(cluster, topic);
  const consumers = useTopicConsumers(cluster, topic);
  const schema = useTopicSchema(cluster, topic, tab === 'schema' || tab === 'overview');
  const metrics = useTopicMetrics(cluster, topic, { range });

  const updateConfigs = useUpdateTopicConfigs(cluster, topic);
  const deleteTopic = useDeleteTopic(cluster);
  const purgeTopic = usePurgeTopic(cluster, topic);
  const addPartitions = useAddPartitions(cluster, topic);

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  if (detail.error) {
    return (
      <div>
        <PageHeader title={topic} />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const data = detail.data;
  const series = metrics.data?.series;
  const partitions = data?.partitionsDetail ?? [];

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{topic}</span>}
        description={
          data
            ? `${data.partitions} partitions · RF ${data.replicationFactor} · ${data.cleanupPolicy} · retention ${formatDuration(data.retentionMs)}`
            : undefined
        }
        meta={
          <span className="flex items-center gap-1.5">
            <CopyButton value={topic} tooltip="Copy topic name" />
            {data?.isInternal ? <Badge variant="secondary">internal</Badge> : null}
            {data && data.underReplicatedPartitions > 0 ? (
              <StatusPill status="degraded" label={`${data.underReplicatedPartitions} URP`} />
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void navigate(`/c/${cluster}/topics`)}>
              <ArrowLeft /> All topics
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Topic actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    setNewPartitions((data?.partitions ?? 0) + 1);
                    setPartitionsOpen(true);
                  }}
                >
                  <SplitSquareHorizontal /> Add partitions
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setPurgeOpen(true)}>
                  <Eraser /> Purge records
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete topic
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="partitions">Partitions</TabsTrigger>
          <TabsTrigger value="configs">Configs</TabsTrigger>
          <TabsTrigger value="consumers">Consumers</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="lineage">Lineage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <StatTileRow columns={4}>
            <StatTile
              label="Partitions"
              loading={detail.isLoading}
              value={data?.partitions ?? '—'}
            />
            <StatTile
              label="Replication factor"
              loading={detail.isLoading}
              value={data?.replicationFactor ?? '—'}
            />
            <StatTile
              label="Under-replicated"
              loading={detail.isLoading}
              value={data?.underReplicatedPartitions ?? '—'}
              tone={(data?.underReplicatedPartitions ?? 0) > 0 ? 'warning' : 'success'}
            />
            <StatTile
              label="Total size"
              loading={detail.isLoading}
              value={formatBytes(data?.sizeBytes)}
            />
            <StatTile
              label="Messages"
              loading={detail.isLoading}
              value={formatCompact(data?.messageCount)}
            />
            <StatTile
              label="Bytes in"
              loading={detail.isLoading}
              value={formatBytesPerSec(data?.bytesInPerSec)}
            />
            <StatTile
              label="Bytes out"
              loading={detail.isLoading}
              value={formatBytesPerSec(data?.bytesOutPerSec)}
            />
            <StatTile
              label="Retention"
              loading={detail.isLoading}
              value={<span className="text-xl">{formatDuration(data?.retentionMs)}</span>}
            />
          </StatTileRow>

          <Card>
            <CardToolbarHeader
              title="Partitions"
              description="Leaders, replicas and in-sync sets"
            />
            <CardContent>
              <PartitionsTable partitions={partitions} loading={detail.isLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="messages">
          <MessagesTab cluster={cluster} topic={topic} partitions={partitions} />
        </TabsContent>

        <TabsContent value="partitions">
          <PartitionsTable
            partitions={partitions}
            loading={detail.isLoading}
            error={detail.error}
            onRetry={() => void detail.refetch()}
          />
        </TabsContent>

        <TabsContent value="configs">
          <ConfigTable
            configs={configs.data}
            loading={configs.isLoading}
            error={configs.error}
            onRetry={() => void configs.refetch()}
            saving={updateConfigs.isPending}
            onSave={async (changes) => {
              try {
                await updateConfigs.mutateAsync({ configs: changes });
                toast.success('Topic configs updated');
              } catch (e) {
                toastError('Failed to update configs', e);
                throw e;
              }
            }}
          />
        </TabsContent>

        <TabsContent value="consumers">
          {consumers.error ? (
            <ErrorState error={consumers.error} onRetry={() => void consumers.refetch()} />
          ) : !consumers.isLoading && (!consumers.data || consumers.data.length === 0) ? (
            <Card>
              <EmptyState
                icon={Users}
                title="No consumer groups"
                description="No group is currently reading this topic."
              />
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Group</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead numeric>Members</TableHead>
                    <TableHead numeric>Lag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(consumers.data ?? []).map((group) => (
                    <TableRow
                      key={group.groupId}
                      clickable
                      onClick={() =>
                        void navigate(
                          `/c/${cluster}/consumers/${encodeURIComponent(group.groupId)}`,
                        )
                      }
                    >
                      <TableCell className="font-mono text-[13px]">{group.groupId}</TableCell>
                      <TableCell>
                        <StatusPill status={group.state} />
                      </TableCell>
                      <TableCell numeric>{group.members}</TableCell>
                      <TableCell
                        numeric
                        className={group.lag > 0 ? 'text-[var(--warning)]' : undefined}
                      >
                        {formatCompact(group.lag)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="schema">
          {schema.error ? (
            <Card>
              <EmptyState
                icon={Database}
                title="Schema Registry unavailable"
                description="No Schema Registry is configured for this cluster, or it could not be reached."
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(['key', 'value'] as const).map((part) => {
                const ref = schema.data?.[part];
                return (
                  <Card key={part}>
                    <CardToolbarHeader
                      title={`${part[0].toUpperCase()}${part.slice(1)} schema`}
                      actions={ref ? <Badge variant="accent">{ref.type}</Badge> : null}
                    />
                    <CardContent>
                      {ref ? (
                        <dl className="space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-xs text-[var(--muted)]">Subject</dt>
                            <dd className="truncate font-mono text-[13px]">{ref.subject}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-xs text-[var(--muted)]">Version</dt>
                            <dd className="font-mono tabular-nums">{ref.version}</dd>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-xs text-[var(--muted)]">Schema id</dt>
                            <dd className="font-mono tabular-nums">{ref.schemaId}</dd>
                          </div>
                          <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                            <Link to={`/c/${cluster}/schemas/${encodeURIComponent(ref.subject)}`}>
                              <ExternalLink /> Open subject
                            </Link>
                          </Button>
                        </dl>
                      ) : (
                        <EmptyState
                          compact
                          icon={Database}
                          title={`No ${part} schema registered`}
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <div className="flex justify-end">
            <TimeRangePicker value={range} onValueChange={setRange} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardToolbarHeader title="Messages in" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['messagesIn'])}
                  unit="msg/s"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  labels={{ messagesIn: 'Messages in' }}
                />
              </CardContent>
            </Card>
            <Card>
              <CardToolbarHeader title="Throughput" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['bytesIn', 'bytesOut'])}
                  unit="bytes/s"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  colorOffset={1}
                  labels={{ bytesIn: 'Bytes in', bytesOut: 'Bytes out' }}
                />
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardToolbarHeader title="Topic size" />
              <CardContent>
                <TimeSeriesChart
                  series={pickSeries(series, ['size'])}
                  unit="bytes"
                  loading={metrics.isLoading}
                  error={metrics.error}
                  colorOffset={4}
                  labels={{ size: 'Size on disk' }}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="lineage">
          <Card>
            <EmptyState
              icon={GitBranch}
              title="Lineage graph"
              description="The stream lineage canvas lands with the governance milestone."
              action={
                <Button asChild variant="outline">
                  <Link to={`/c/${cluster}/lineage?focus=topic:${encodeURIComponent(topic)}`}>
                    Open lineage
                  </Link>
                </Button>
              }
            />
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDestructiveDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete topic"
        description={
          <>
            This permanently removes <span className="font-mono">{topic}</span> and all of its data.
          </>
        }
        confirmText={topic}
        confirmLabel="Delete topic"
        loading={deleteTopic.isPending}
        onConfirm={async () => {
          try {
            await deleteTopic.mutateAsync(topic);
            toast.success(`Topic ${topic} deleted`);
            void navigate(`/c/${cluster}/topics`);
          } catch (e) {
            toastError('Failed to delete topic', e);
          }
        }}
      />

      <ConfirmDestructiveDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Purge all records"
        description={
          <>
            Deletes every record in <span className="font-mono">{topic}</span>. The topic is kept.
          </>
        }
        confirmText={topic}
        confirmLabel="Purge records"
        loading={purgeTopic.isPending}
        onConfirm={async () => {
          try {
            await purgeTopic.mutateAsync(undefined);
            toast.success('Records purged');
            setPurgeOpen(false);
          } catch (e) {
            toastError('Failed to purge topic', e);
          }
        }}
      />

      <Dialog open={partitionsOpen} onOpenChange={setPartitionsOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add partitions</DialogTitle>
            <DialogDescription>
              Partition count can only increase and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="new-partitions">New partition count</Label>
            <Input
              id="new-partitions"
              type="number"
              min={(data?.partitions ?? 0) + 1}
              value={newPartitions}
              onChange={(e) => setNewPartitions(Number(e.target.value))}
            />
            <p className="text-2xs text-[var(--muted)]">
              Currently {data?.partitions ?? '—'} partitions.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartitionsOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={addPartitions.isPending}
              disabled={newPartitions <= (data?.partitions ?? 0)}
              onClick={async () => {
                try {
                  await addPartitions.mutateAsync({ count: newPartitions });
                  toast.success('Partitions added');
                  setPartitionsOpen(false);
                } catch (e) {
                  toastError('Failed to add partitions', e);
                }
              }}
            >
              Add partitions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TopicDetailPage;
