import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  Braces,
  Cable,
  ChevronDown,
  ChevronRight,
  Eraser,
  RotateCcw,
  Save,
  TableProperties,
  Trash2,
} from 'lucide-react';
import {
  useConnector,
  useConnectorOffsets,
  useConnectorTopics,
  usePatchConnectorOffsets,
  useResetConnectorOffsets,
  useResetConnectorTopics,
  useRestartConnectorTask,
  useUpdateConnectorConfig,
} from '@/api/hooks/connect';
import type { ConnectorOffsetsPatch, ConnectorTask } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { CodeEditor } from '@/components/CodeEditor';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, InlineError } from '@/components/ui/error-state';
import { JsonViewer } from '@/components/ui/json-viewer';
import {
  KeyValueEditor,
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from '@/components/ui/key-value-editor';
import { PageHeader } from '@/components/ui/page-header';
import {
  SegmentedList,
  SegmentedTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { ConnectorActionsMenu } from './components/ConnectorActions';
import { TasksMiniBar } from './components/TasksMiniBar';
import { connectorStateTone, shortClass, taskCounts } from './components/connectUtils';

const TABS = ['overview', 'config', 'tasks', 'topics', 'offsets'];

export function ConnectorDetailPage() {
  const cluster = useClusterId();
  const { kc: kcParam = '', name: nameParam = '' } = useParams<{ kc: string; name: string }>();
  const kc = decodeURIComponent(kcParam);
  const name = decodeURIComponent(nameParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab') ?? 'overview';
  const tab = TABS.includes(requestedTab) ? requestedTab : 'overview';
  const base = `/c/${cluster}/connect/${encodeURIComponent(kc)}`;

  const connector = useConnector(cluster, kc, name);
  const topics = useConnectorTopics(cluster, kc, name, tab === 'topics');
  const offsets = useConnectorOffsets(cluster, kc, name);
  const updateConfig = useUpdateConnectorConfig(cluster, kc, name);
  const resetTopics = useResetConnectorTopics(cluster, kc, name);
  const restartTask = useRestartConnectorTask(cluster, kc, name);
  const patchOffsets = usePatchConnectorOffsets(cluster, kc, name);
  const resetOffsets = useResetConnectorOffsets(cluster, kc, name);

  const [configView, setConfigView] = useState<'pairs' | 'json'>('pairs');
  const [pairs, setPairs] = useState<KeyValuePair[]>([]);
  const [configJson, setConfigJson] = useState('{}');
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [offsetsDraft, setOffsetsDraft] = useState('');
  const [offsetsDirty, setOffsetsDirty] = useState(false);
  const [confirmResetOffsets, setConfirmResetOffsets] = useState(false);
  const [confirmResetTopics, setConfirmResetTopics] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<number | null>(null);

  const data = connector.data;
  const counts = taskCounts(data?.tasks);
  const state = (data?.state ?? '').toUpperCase();
  const isStopped = state === 'STOPPED';

  /* Seed the config editors once the connector loads (and after a save). */
  useEffect(() => {
    if (!data?.config || dirty) return;
    setPairs(recordToPairs(data.config));
    setConfigJson(JSON.stringify(data.config, null, 2));
  }, [data?.config, dirty]);

  useEffect(() => {
    if (!offsets.data || offsetsDirty) return;
    setOffsetsDraft(JSON.stringify(offsets.data, null, 2));
  }, [offsets.data, offsetsDirty]);

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const currentConfig = useMemo<Record<string, string>>(() => {
    if (configView === 'pairs') return pairsToRecord(pairs);
    try {
      const parsed = JSON.parse(configJson) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]),
      );
    } catch {
      return {};
    }
  }, [configView, pairs, configJson]);

  const saveConfig = async () => {
    if (configError) return;
    try {
      await updateConfig.mutateAsync(currentConfig);
      toast.success('Configuration saved');
      setDirty(false);
    } catch (e) {
      toastError('Failed to save configuration', e);
    }
  };

  const topicList = useMemo(() => {
    const raw = topics.data;
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.topics)) return raw.topics;
    return data?.topics ?? [];
  }, [topics.data, data?.topics]);

  if (connector.error) {
    return (
      <div>
        <PageHeader title={<span className="font-mono">{name}</span>} />
        <ErrorState error={connector.error} onRetry={() => void connector.refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{name}</span>}
        description={
          data
            ? `${data.type} · ${shortClass(data.connectorClass)} · ${counts.total} task${counts.total === 1 ? '' : 's'}`
            : 'Connector'
        }
        meta={
          <span className="flex items-center gap-1.5">
            <CopyButton value={name} tooltip="Copy connector name" />
            {data ? (
              <StatusPill
                status={data.state}
                tone={connectorStateTone(data.state)}
                pulse={state === 'RESTARTING'}
              />
            ) : null}
            {counts.failed > 0 ? (
              <Badge variant="danger">
                {counts.failed} failed task{counts.failed === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={base}>
                <ArrowLeft /> Connectors
              </Link>
            </Button>
            {data ? (
              <ConnectorActionsMenu
                cluster={cluster}
                kc={kc}
                connector={data}
                labelled
                onDeleted={() => void navigate(base)}
              />
            ) : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="offsets">Offsets</TabsTrigger>
        </TabsList>

        {/* ------------------------------- overview ------------------------------ */}
        <TabsContent value="overview" className="space-y-4">
          <StatTileRow columns={5}>
            <StatTile label="Type" loading={connector.isLoading} value={data?.type ?? '—'} />
            <StatTile
              label="State"
              loading={connector.isLoading}
              value={data?.state ?? '—'}
              tone={connectorStateTone(data?.state)}
            />
            <StatTile
              label="Tasks running"
              loading={connector.isLoading}
              value={`${counts.running}/${counts.total}`}
              tone={counts.failed > 0 ? 'danger' : counts.running > 0 ? 'success' : 'muted'}
            />
            <StatTile
              label="Failed tasks"
              loading={connector.isLoading}
              value={counts.failed}
              tone={counts.failed > 0 ? 'danger' : 'muted'}
            />
            <StatTile label="Topics" loading={connector.isLoading} value={topicList.length} />
          </StatTileRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Connector</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {connector.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <>
                    <Row label="Class">
                      <Tooltip content={data?.connectorClass ?? ''}>
                        <span className="truncate font-mono">
                          {shortClass(data?.connectorClass)}
                        </span>
                      </Tooltip>
                    </Row>
                    <Row label="Worker">
                      <span className="truncate font-mono">{data?.workerId ?? '—'}</span>
                    </Row>
                    <Row label="Tasks">
                      <TasksMiniBar tasks={data?.tasks} />
                    </Row>
                    <Row label="Connect cluster">
                      <Link to={base} className="font-mono text-[var(--primary)] hover:underline">
                        {kc}
                      </Link>
                    </Row>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Topics</CardTitle>
              </CardHeader>
              <CardContent>
                {connector.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : topicList.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    No topics reported for this connector yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {topicList.map((topic) => (
                      <Link key={topic} to={`/c/${cluster}/topics/${encodeURIComponent(topic)}`}>
                        <Badge variant="secondary" className="font-mono">
                          {topic}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* -------------------------------- config ------------------------------- */}
        <TabsContent value="config">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Configuration</CardTitle>
              <div className="flex items-center gap-2">
                <Tabs
                  value={configView}
                  onValueChange={(v) => setConfigView(v as 'pairs' | 'json')}
                >
                  <SegmentedList>
                    <SegmentedTrigger value="pairs">
                      <TableProperties className="size-3.5" /> Key / value
                    </SegmentedTrigger>
                    <SegmentedTrigger value="json">
                      <Braces className="size-3.5" /> JSON
                    </SegmentedTrigger>
                  </SegmentedList>
                </Tabs>
                <Button
                  loading={updateConfig.isPending}
                  disabled={!dirty || Boolean(configError)}
                  onClick={() => void saveConfig()}
                >
                  <Save /> Save
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {connector.isLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : configView === 'pairs' ? (
                <KeyValueEditor
                  value={pairs}
                  onChange={(next) => {
                    setPairs(next);
                    setConfigJson(JSON.stringify(pairsToRecord(next), null, 2));
                    setDirty(true);
                  }}
                  keyPlaceholder="config.key"
                  valuePlaceholder="value"
                  addLabel="Add config"
                />
              ) : (
                <>
                  <CodeEditor
                    value={configJson}
                    onChange={(text) => {
                      setConfigJson(text);
                      setDirty(true);
                      try {
                        const parsed = JSON.parse(text) as Record<string, unknown>;
                        setPairs(
                          Object.entries(parsed).map(([key, value]) => ({
                            key,
                            value: value === null || value === undefined ? '' : String(value),
                          })),
                        );
                        setConfigError(null);
                      } catch (e) {
                        setConfigError(e instanceof Error ? e.message : 'Invalid JSON');
                      }
                    }}
                    language="json"
                    minimal={false}
                    height={460}
                    ariaLabel="Connector configuration"
                  />
                  {configError ? (
                    <p className="font-mono text-2xs text-[var(--danger)]">{configError}</p>
                  ) : null}
                </>
              )}
              <p className="text-2xs text-[var(--muted)]">
                Saving performs <span className="font-mono">PUT /connectors/{name}/config</span> —
                the connector restarts with the new configuration.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------- tasks -------------------------------- */}
        <TabsContent value="tasks">
          <Card>
            {connector.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (data?.tasks?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Cable}
                title="No tasks"
                description="This connector has not been assigned any tasks."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Task</TableHead>
                    <TableHead className="w-32">State</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.tasks ?? []).map((task: ConnectorTask) => (
                    <Fragment key={task.id}>
                      <TableRow>
                        <TableCell className="font-mono tabular-nums">{task.id}</TableCell>
                        <TableCell>
                          <StatusPill status={task.state} tone={connectorStateTone(task.state)} />
                        </TableCell>
                        <TableCell>
                          <span className="truncate font-mono text-2xs text-[var(--muted)]">
                            {task.workerId ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {task.trace ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setExpandedTrace(expandedTrace === task.id ? null : task.id)
                                }
                              >
                                {expandedTrace === task.id ? <ChevronDown /> : <ChevronRight />}
                                Trace
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              loading={restartTask.isPending && restartTask.variables === task.id}
                              onClick={async () => {
                                try {
                                  await restartTask.mutateAsync(task.id);
                                  toast.success(`Task ${task.id} restarted`);
                                } catch (e) {
                                  toastError('Failed to restart task', e);
                                }
                              }}
                            >
                              <RotateCcw /> Restart
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedTrace === task.id && task.trace ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={4} className="bg-[var(--surface-2)] p-0">
                            <pre className="max-h-80 overflow-auto p-3 font-mono text-2xs leading-4 text-[var(--danger)]">
                              {task.trace}
                            </pre>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* -------------------------------- topics ------------------------------- */}
        <TabsContent value="topics">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Active topics</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmResetTopics(true)}
                disabled={topicList.length === 0}
              >
                <Eraser /> Reset topic set
              </Button>
            </CardHeader>
            <CardContent>
              {topics.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : topics.error ? (
                <InlineError error={topics.error} onRetry={() => void topics.refetch()} />
              ) : topicList.length === 0 ? (
                <EmptyState
                  compact
                  icon={Cable}
                  title="No active topics"
                  description="Connect has not recorded any topics for this connector."
                />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {topicList.map((topic) => (
                    <li key={topic} className="flex items-center justify-between gap-3 py-2">
                      <Link
                        to={`/c/${cluster}/topics/${encodeURIComponent(topic)}`}
                        className="truncate font-mono text-[13px] text-[var(--primary)] hover:underline"
                      >
                        {topic}
                      </Link>
                      <CopyButton value={topic} tooltip="Copy topic name" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------- offsets ------------------------------- */}
        <TabsContent value="offsets" className="space-y-4">
          {!isStopped ? (
            <div className="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-xs">
              Offsets can only be modified while the connector is{' '}
              <span className="font-mono">STOPPED</span>. Stop it from the Actions menu first —
              current offsets are read-only until then.
            </div>
          ) : null}

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Committed offsets</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isStopped || !offsetsDirty}
                  loading={patchOffsets.isPending}
                  onClick={async () => {
                    try {
                      const parsed = JSON.parse(offsetsDraft) as ConnectorOffsetsPatch;
                      await patchOffsets.mutateAsync(parsed);
                      toast.success('Offsets updated');
                      setOffsetsDirty(false);
                    } catch (e) {
                      toastError('Failed to update offsets', e);
                    }
                  }}
                >
                  <Save /> Apply offsets
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!isStopped}
                  onClick={() => setConfirmResetOffsets(true)}
                >
                  <Trash2 /> Reset offsets
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {offsets.isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : offsets.error ? (
                <InlineError error={offsets.error} onRetry={() => void offsets.refetch()} />
              ) : isStopped ? (
                <CodeEditor
                  value={offsetsDraft}
                  onChange={(v) => {
                    setOffsetsDraft(v);
                    setOffsetsDirty(true);
                  }}
                  language="json"
                  minimal={false}
                  height={400}
                  ariaLabel="Connector offsets"
                />
              ) : (
                <JsonViewer value={offsets.data ?? {}} maxHeight={400} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDestructiveDialog
        open={confirmResetOffsets}
        onOpenChange={setConfirmResetOffsets}
        title="Reset connector offsets"
        description={
          <>
            Deletes all committed offsets for <span className="font-mono">{name}</span>. On resume
            the connector starts from the beginning of its source or topics.
          </>
        }
        confirmText={name}
        confirmLabel="Reset offsets"
        loading={resetOffsets.isPending}
        onConfirm={async () => {
          try {
            await resetOffsets.mutateAsync();
            toast.success('Offsets reset');
            setOffsetsDirty(false);
            setConfirmResetOffsets(false);
          } catch (e) {
            toastError('Failed to reset offsets', e);
          }
        }}
      />

      <ConfirmDestructiveDialog
        open={confirmResetTopics}
        onOpenChange={setConfirmResetTopics}
        title="Reset active topic set"
        description={
          <>
            Clears the recorded set of topics for <span className="font-mono">{name}</span>. It is
            rebuilt as the connector produces or consumes again.
          </>
        }
        confirmLabel="Reset topics"
        loading={resetTopics.isPending}
        onConfirm={async () => {
          try {
            await resetTopics.mutateAsync();
            toast.success('Topic set reset');
            setConfirmResetTopics(false);
          } catch (e) {
            toastError('Failed to reset topics', e);
          }
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

export default ConnectorDetailPage;
