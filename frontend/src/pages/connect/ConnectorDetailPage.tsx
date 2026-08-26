import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  TableProperties,
  Trash2,
} from 'lucide-react';
import {
  useConnector,
  useConnectorAction,
  useConnectorOffsets,
  useConnectorTopics,
  usePatchConnectorOffsets,
  useResetConnectorOffsets,
  useResetConnectorTopics,
  useRestartConnectorTask,
  useUpdateConnectorConfig,
  useValidatePlugin,
} from '@/api/hooks/connect';
import type { ConnectorOffsetsPatch, ConnectorTask, ConnectorValidationEntry } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { CodeEditor } from '@/components/CodeEditor';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { DiffView } from '@/components/DiffView';
import { StatTile, StatTileRow } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { RefreshPicker } from '@/components/ui/refresh-picker';
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
import { ConnectorActionsMenu, StopConnectorDialog } from './components/ConnectorActions';
import { TasksMiniBar } from './components/TasksMiniBar';
import { UnsavedChangesGuard } from './components/UnsavedChangesGuard';
import {
  connectorStateTone,
  maskConfigValue,
  shortClass,
  taskCounts,
} from './components/connectUtils';

const TABS = ['overview', 'config', 'tasks', 'topics', 'offsets'];

/* ----------------------------- secret masking ----------------------------- */

const MASK = maskConfigValue('password', 'x');

function isSecretKey(key: string): boolean {
  return maskConfigValue(key, 'x') === MASK;
}

/** Real values of the loaded secrets; a row keeps masking them even if its key is renamed. */
type SecretValues = ReadonlySet<string>;

function secretValuesOf(record: Record<string, string> | undefined): Set<string> {
  return new Set(
    Object.entries(record ?? {})
      .filter(([key, value]) => isSecretKey(key) && value !== '')
      .map(([, value]) => value),
  );
}

function isHidden(key: string, value: string, secrets: SecretValues): boolean {
  return isSecretKey(key) || secrets.has(value);
}

function maskValue(key: string, value: string, secrets: SecretValues): string {
  return isHidden(key, value, secrets) ? MASK : value;
}

function maskRecord(record: Record<string, string>, secrets: SecretValues): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, maskValue(key, value, secrets)]),
  );
}

function maskPairs(pairs: KeyValuePair[], secrets: SecretValues): KeyValuePair[] {
  return pairs.map((pair) => ({ ...pair, value: maskValue(pair.key, pair.value, secrets) }));
}

function countSecrets(record: Record<string, string>, secrets: SecretValues): number {
  return Object.entries(record).filter(([key, value]) => isHidden(key, value, secrets)).length;
}

/** True when a masked placeholder survived unmasking (new/renamed/pasted key). */
function hasMaskPlaceholder(record: Record<string, string>): boolean {
  return Object.values(record).some((value) => value === MASK);
}

const MASK_ERROR = 'Reveal secrets before editing masked keys';

/**
 * The key/value editor only sees masked values while secrets are hidden. Map
 * untouched masked rows back to their real values so the mask is never saved.
 * Handles the editor's three operations: update (same length), add (+1 at the
 * end) and remove (-1 at an arbitrary index). Rows are matched by position, so a
 * renamed secret row keeps its real value (and stays masked via `secrets`).
 */
function unmaskPairs(
  next: KeyValuePair[],
  real: KeyValuePair[],
  secrets: SecretValues,
): KeyValuePair[] {
  const masked = maskPairs(real, secrets);
  let removed = -1;
  if (next.length === real.length - 1) {
    removed = masked.findIndex(
      (pair, i) => !next[i] || next[i].key !== pair.key || next[i].value !== pair.value,
    );
    if (removed === -1) removed = real.length - 1;
  }
  return next.map((pair, i) => {
    const source = removed !== -1 && i >= removed ? i + 1 : i;
    const original = real[source];
    if (original && pair.value === MASK && isHidden(original.key, original.value, secrets)) {
      return { ...pair, value: original.value };
    }
    return pair;
  });
}

/** Same idea for the JSON view: masked values are matched back by key. */
function unmaskRecord(
  next: Record<string, string>,
  real: Record<string, string>,
  secrets: SecretValues,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) =>
      value === MASK && key in real && isHidden(key, real[key], secrets)
        ? [key, real[key]]
        : [key, value],
    ),
  );
}

function parseConfigJson(text: string): Record<string, string> {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]),
  );
}

export function ConnectorDetailPage() {
  const cluster = useClusterId();
  const { kc: kcParam = '', name: nameParam = '' } = useParams<{ kc: string; name: string }>();
  const kc = decodeURIComponent(kcParam);
  const name = decodeURIComponent(nameParam);
  const navigate = useNavigate();
  const { canEdit } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab') ?? 'overview';
  const tab = TABS.includes(requestedTab) ? requestedTab : 'overview';
  const base = `/c/${cluster}/connect/${encodeURIComponent(kc)}`;

  const connector = useConnector(cluster, kc, name);
  /* The Overview tab reads the topic list too, so fetch for both tabs. */
  const topics = useConnectorTopics(cluster, kc, name, tab === 'overview' || tab === 'topics');
  const offsets = useConnectorOffsets(cluster, kc, name);
  const updateConfig = useUpdateConnectorConfig(cluster, kc, name);
  const validate = useValidatePlugin(cluster, kc);
  const action = useConnectorAction(cluster, kc);
  const resetTopics = useResetConnectorTopics(cluster, kc, name);
  const restartTask = useRestartConnectorTask(cluster, kc, name);
  const patchOffsets = usePatchConnectorOffsets(cluster, kc, name);
  const resetOffsets = useResetConnectorOffsets(cluster, kc, name);

  const [configView, setConfigView] = useState<'pairs' | 'json'>('pairs');
  const [pairs, setPairs] = useState<KeyValuePair[]>([]);
  const [configJson, setConfigJson] = useState('{}');
  /** Text shown in the JSON editor — masked unless secrets are revealed. */
  const [jsonDraft, setJsonDraft] = useState('{}');
  const [configError, setConfigError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [offsetsDraft, setOffsetsDraft] = useState('');
  const [offsetsDirty, setOffsetsDirty] = useState(false);
  const [confirmResetOffsets, setConfirmResetOffsets] = useState(false);
  const [confirmResetTopics, setConfirmResetTopics] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set());
  const [reveal, setReveal] = useState<{ pairs: boolean; json: boolean }>({
    pairs: false,
    json: false,
  });
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [validatedKey, setValidatedKey] = useState<string | null>(null);

  const data = connector.data;
  const counts = taskCounts(data?.tasks);
  const state = (data?.state ?? '').toUpperCase();
  const isStopped = state === 'STOPPED';
  const isFailed = state === 'FAILED';

  const secretValues = useMemo(() => secretValuesOf(data?.config), [data?.config]);

  /* Seed the config editors once the connector loads (and after a save). */
  useEffect(() => {
    if (!data?.config || dirty) return;
    setPairs(recordToPairs(data.config));
    setConfigJson(JSON.stringify(data.config, null, 2));
    setJsonDraft(
      JSON.stringify(reveal.json ? data.config : maskRecord(data.config, secretValues), null, 2),
    );
  }, [data?.config, dirty, reveal.json, secretValues]);

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
      return parseConfigJson(configJson);
    } catch {
      return {};
    }
  }, [configView, pairs, configJson]);

  const secretCount = countSecrets(currentConfig, secretValues);

  /** Re-render the JSON editor text from state (on view switch / reveal toggle). */
  const syncJsonDraft = (revealSecrets: boolean) => {
    setJsonDraft(
      revealSecrets ? configJson : JSON.stringify(maskRecord(currentConfig, secretValues), null, 2),
    );
  };

  /* ---- live validation against the plugin (debounced) ---- */
  const pluginClass = currentConfig['connector.class'] || data?.connectorClass || '';
  const validationKey = useMemo(
    () => JSON.stringify({ ...currentConfig, name }),
    [currentConfig, name],
  );
  const debouncedKey = useDebounced(validationKey, 500);
  const validateMutate = validate.mutate;

  const runValidation = useCallback(
    (key: string) => {
      if (!pluginClass) return;
      setValidatedKey(key);
      validateMutate({ pluginClass, config: JSON.parse(key) as Record<string, string> });
    },
    [pluginClass, validateMutate],
  );

  useEffect(() => {
    if (tab !== 'config' || !dirty || configError || !pluginClass) return;
    runValidation(debouncedKey);
  }, [tab, dirty, configError, pluginClass, debouncedKey, runValidation]);

  const validation = validate.data;
  const errorCount = validation?.errorCount ?? 0;
  const validationStale = validatedKey !== validationKey;
  const fieldErrors = useMemo(
    () =>
      ((validation?.configs ?? []) as ConnectorValidationEntry[]).filter(
        (entry) => (entry.value?.errors?.length ?? 0) > 0,
      ),
    [validation],
  );
  const validationBlocksSave = validate.error
    ? false
    : validate.isPending || validationStale || errorCount > 0;
  const canSave = canEdit && dirty && !configError && !validationBlocksSave;

  const saveConfig = async () => {
    if (configError) return;
    try {
      await updateConfig.mutateAsync(currentConfig);
      toast.success('Configuration saved — connector is restarting');
      setDirty(false);
      setConfirmSave(false);
      setValidatedKey(null);
      validate.reset();
    } catch (e) {
      toastError('Failed to save configuration', e);
    }
  };

  const stopConnector = async () => {
    try {
      await action.mutateAsync({ name, action: 'stop' });
      toast.success(`${name} stopped`);
      setConfirmStop(false);
    } catch (e) {
      toastError('Failed to stop connector', e);
    }
  };

  const toggleTrace = (id: number) =>
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
      <UnsavedChangesGuard
        dirty={dirty || offsetsDirty}
        description={
          offsetsDirty && !dirty
            ? 'Your edited offsets have not been applied and will be lost if you leave this page.'
            : 'Your configuration edits have not been saved and will be lost if you leave this page.'
        }
      />
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
            <RefreshPicker
              onRefresh={() => {
                void connector.refetch();
                if (tab === 'overview' || tab === 'topics') void topics.refetch();
                if (tab === 'offsets') void offsets.refetch();
              }}
              refreshing={connector.isFetching}
            />
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
              <div className="flex items-center gap-2">
                <CardTitle>Configuration</CardTitle>
                {dirty && !configError ? (
                  validate.isPending || validationStale ? (
                    <span className="flex items-center gap-1 text-2xs text-[var(--muted)]">
                      <RefreshCw className="size-3 animate-spin" /> validating
                    </span>
                  ) : validate.error ? null : errorCount > 0 ? (
                    <Badge variant="danger">
                      {errorCount} error{errorCount === 1 ? '' : 's'}
                    </Badge>
                  ) : validation ? (
                    <Badge variant="success">
                      <Check className="size-3" /> valid
                    </Badge>
                  ) : null
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Tabs
                  value={configView}
                  onValueChange={(v) => {
                    const next = v as 'pairs' | 'json';
                    if (next === 'json' && !configError) syncJsonDraft(reveal.json);
                    setConfigView(next);
                  }}
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
                <Tooltip
                  content={
                    !canEdit
                      ? REQUIRES_EDITOR
                      : !dirty
                        ? 'No changes'
                        : configError
                          ? configError
                          : errorCount > 0
                            ? 'Fix validation errors first'
                            : validationBlocksSave
                              ? 'Waiting for validation'
                              : 'Review changes and save'
                  }
                >
                  <span className="inline-flex">
                    <Button disabled={!canSave} onClick={() => setConfirmSave(true)}>
                      <Save /> Save
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-[var(--muted)]">
                <span>
                  {secretCount > 0
                    ? reveal[configView]
                      ? `${secretCount} sensitive value${secretCount === 1 ? '' : 's'} shown in plain text`
                      : `${secretCount} sensitive value${secretCount === 1 ? '' : 's'} hidden`
                    : 'No sensitive values detected'}
                </span>
                {secretCount > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = !reveal[configView];
                      if (configView === 'json' && !configError) syncJsonDraft(next);
                      setReveal((r) => ({ ...r, [configView]: next }));
                    }}
                    aria-pressed={reveal[configView]}
                  >
                    {reveal[configView] ? (
                      <>
                        <EyeOff /> Hide secrets
                      </>
                    ) : (
                      <>
                        <Eye /> Reveal secrets
                      </>
                    )}
                  </Button>
                ) : null}
              </div>

              {connector.isLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : configView === 'pairs' ? (
                <>
                  <KeyValueEditor
                    value={reveal.pairs ? pairs : maskPairs(pairs, secretValues)}
                    onChange={(edited) => {
                      const next = reveal.pairs ? edited : unmaskPairs(edited, pairs, secretValues);
                      const record = pairsToRecord(next);
                      setPairs(next);
                      setConfigJson(JSON.stringify(record, null, 2));
                      setConfigError(hasMaskPlaceholder(record) ? MASK_ERROR : null);
                      setDirty(true);
                    }}
                    keyPlaceholder="config.key"
                    valuePlaceholder="value"
                    addLabel="Add config"
                  />
                  {configError ? (
                    <p className="font-mono text-2xs text-[var(--danger)]">{configError}</p>
                  ) : null}
                </>
              ) : (
                <>
                  <CodeEditor
                    value={jsonDraft}
                    onChange={(text) => {
                      setJsonDraft(text);
                      setDirty(true);
                      try {
                        /* Masked placeholders are mapped back to the real values by key. */
                        const parsed = reveal.json
                          ? parseConfigJson(text)
                          : unmaskRecord(parseConfigJson(text), currentConfig, secretValues);
                        setConfigJson(JSON.stringify(parsed, null, 2));
                        setPairs(recordToPairs(parsed));
                        setConfigError(hasMaskPlaceholder(parsed) ? MASK_ERROR : null);
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

              {validate.error && dirty ? (
                <InlineError error={validate.error} onRetry={() => runValidation(validationKey)} />
              ) : null}

              {dirty && !configError && !validationStale && fieldErrors.length > 0 ? (
                <div className="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-3 py-2">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                    <AlertTriangle className="size-3.5" />
                    {errorCount} validation error{errorCount === 1 ? '' : 's'} — Save is disabled
                    until they are fixed
                  </p>
                  <ul className="space-y-1 text-2xs">
                    {fieldErrors.map((entry) => (
                      <li key={entry.definition.name} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-[var(--foreground)]">
                          {entry.definition.name}
                        </span>
                        <span className="text-[var(--muted)]">
                          {entry.value.errors.join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="text-2xs text-[var(--muted)]">
                Saving performs <span className="font-mono">PUT /connectors/{name}/config</span> —
                the connector restarts with the new configuration. Changes are validated against{' '}
                <span className="font-mono">{shortClass(pluginClass)}</span> as you type.
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
            ) : (
              <>
                {isFailed && data?.trace ? (
                  <div className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]">
                    <div className="flex items-center justify-between gap-2 px-4 pt-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                        <AlertTriangle className="size-3.5" /> Connector failed
                      </p>
                      <CopyButton value={data.trace} tooltip="Copy connector trace" />
                    </div>
                    <pre className="max-h-80 overflow-auto px-4 pb-3 pt-2 font-mono text-2xs leading-4 text-[var(--danger)]">
                      {data.trace}
                    </pre>
                  </div>
                ) : null}
                {(data?.tasks?.length ?? 0) === 0 ? (
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
                              <StatusPill
                                status={task.state}
                                tone={connectorStateTone(task.state)}
                              />
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
                                    onClick={() => toggleTrace(task.id)}
                                    aria-expanded={expandedTraces.has(task.id)}
                                  >
                                    {expandedTraces.has(task.id) ? (
                                      <ChevronDown />
                                    ) : (
                                      <ChevronRight />
                                    )}
                                    Trace
                                  </Button>
                                ) : null}
                                <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                                  <span className="inline-flex">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!canEdit}
                                      loading={
                                        restartTask.isPending && restartTask.variables === task.id
                                      }
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
                                  </span>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                          {expandedTraces.has(task.id) && task.trace ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={4} className="bg-[var(--surface-2)] p-0">
                                <div className="relative">
                                  <CopyButton
                                    value={task.trace}
                                    tooltip={`Copy task ${task.id} trace`}
                                    className="absolute right-2 top-2"
                                  />
                                  <pre className="max-h-80 overflow-auto p-3 pr-10 font-mono text-2xs leading-4 text-[var(--danger)]">
                                    {task.trace}
                                  </pre>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </Card>
        </TabsContent>

        {/* -------------------------------- topics ------------------------------- */}
        <TabsContent value="topics">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Active topics</CardTitle>
              <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmResetTopics(true)}
                    disabled={!canEdit || topicList.length === 0}
                  >
                    <Eraser /> Reset topic set
                  </Button>
                </span>
              </Tooltip>
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-xs">
              <span>
                Offsets can only be modified while the connector is{' '}
                <span className="font-mono">STOPPED</span> — current offsets are read-only until
                then.
              </span>
              <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || !data}
                    loading={action.isPending}
                    onClick={() => setConfirmStop(true)}
                  >
                    <Square /> Stop connector
                  </Button>
                </span>
              </Tooltip>
            </div>
          ) : null}

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Committed offsets</CardTitle>
              <div className="flex items-center gap-2">
                <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canEdit || !isStopped || !offsetsDirty}
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
                  </span>
                </Tooltip>
                <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                  <span className="inline-flex">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!canEdit || !isStopped}
                      onClick={() => setConfirmResetOffsets(true)}
                    >
                      <Trash2 /> Reset offsets
                    </Button>
                  </span>
                </Tooltip>
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

      <StopConnectorDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        connectorName={name}
        loading={action.isPending}
        onConfirm={stopConnector}
      />

      <Dialog open={confirmSave} onOpenChange={setConfirmSave}>
        <DialogContent size="lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]">
                <AlertTriangle className="size-4 text-[var(--warning)]" />
              </span>
              <div className="space-y-1">
                <DialogTitle>Save configuration</DialogTitle>
                <DialogDescription>
                  Review the changes below. Saving restarts{' '}
                  <span className="font-mono">{name}</span> and all of its tasks with the new
                  configuration.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <DiffView
              from={JSON.stringify(maskRecord(data?.config ?? {}, secretValues), null, 2)}
              to={JSON.stringify(maskRecord(currentConfig, secretValues), null, 2)}
              fromLabel="current"
              toLabel="edited"
              maxHeight={360}
            />
            {secretCount > 0 ? (
              <p className="text-2xs text-[var(--muted)]">
                Sensitive values are masked in this preview; the real values are saved.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSave(false)}
              disabled={updateConfig.isPending}
            >
              Cancel
            </Button>
            <Button loading={updateConfig.isPending} onClick={() => void saveConfig()}>
              <Save /> Save &amp; restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
