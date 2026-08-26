import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eraser, History, Play, Settings2, Square, Terminal, Trash2, Zap } from 'lucide-react';
import {
  KSQL_ROW_LIMITS,
  useCloseKsqlQuery,
  useKsqlClusters,
  useKsqlHistory,
  useKsqlQueries,
  useKsqlQueryStream,
  useKsqlStatement,
  useKsqlStreams,
  useKsqlTables,
  useTerminateKsqlQuery,
} from '@/api/hooks/ksql';
import type { KsqlQueryInfo, KsqlStatementResult } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { enumCodec, useSearchParamState } from '@/hooks/useUrlState';
import { UnsavedChangesGuard } from '@/pages/connect/components/UnsavedChangesGuard';
import { formatRelative, truncate } from '@/lib/format';
import { CodeEditor } from '@/components/CodeEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { KeyValueEditor, pairsToRecord, type KeyValuePair } from '@/components/ui/key-value-editor';
import { PageHeader } from '@/components/ui/page-header';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { KsqlDescribeSheet } from './components/KsqlDescribeSheet';
import { KsqlQueriesTable } from './components/KsqlQueriesTable';
import { KsqlResultsGrid } from './components/KsqlResultsGrid';
import { KsqlSidebar, type KsqlObjectKind } from './components/KsqlSidebar';
import { KsqlStatementResults } from './components/KsqlStatementResults';

const DEFAULT_SQL = 'SHOW STREAMS;';

interface RecentStatement {
  sql: string;
  /** Epoch millis of the last run. */
  ts: number;
}

const RECENTS_MAX = 25;
const recentsKey = (cluster: string, server: string) => `k-shui.ksql.recents.${cluster}.${server}`;

function loadRecents(key: string): RecentStatement[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentStatement =>
          typeof r === 'object' && r !== null && typeof (r as RecentStatement).sql === 'string',
      )
      .map((r) => ({ sql: r.sql, ts: Number(r.ts) || 0 }))
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

function saveRecents(key: string, items: RecentStatement[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(0, RECENTS_MAX)));
  } catch {
    /* quota / private mode — history is a convenience only */
  }
}

/** Server history timestamps are epoch seconds (float) or ISO strings. */
function historyTs(ts: string | number | null | undefined): number {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  if (!ts) return 0;
  const n = Number(ts);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(ts);
  return Number.isNaN(d) ? 0 : d;
}

/**
 * Push vs pull classification. `EMIT CHANGES` is always a push query; a SELECT
 * with no WHERE predicate (i.e. no key lookup) is treated as an unbounded scan too.
 */
export function classifyKsqlQuery(sql: string): 'push' | 'pull' | null {
  const text = sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
  if (!/^select\b/i.test(text)) return null;
  if (/\bemit\s+changes\b/i.test(text)) return 'push';
  if (!/\bwhere\b/i.test(text)) return 'push';
  return 'pull';
}

/** Statements that only read catalog metadata — safe for viewers to execute. */
function isReadOnlyKsqlStatement(sql: string): boolean {
  const text = sql.replace(/--.*$/gm, '').trim();
  const statements = text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length === 0) return true;
  return statements.every((s) => /^(SELECT|SHOW|LIST|DESCRIBE|EXPLAIN|PRINT)\b/i.test(s));
}

const KSQL_TABS = ['editor', 'queries'] as const;
const ksqlTabCodec = enumCodec(KSQL_TABS, 'editor');

const PROPERTY_SUGGESTIONS = [
  'auto.offset.reset',
  'ksql.streams.auto.offset.reset',
  'processing.guarantee',
  'ksql.query.pull.table.scan.enabled',
  'cache.max.bytes.buffering',
];

export function KsqlPage() {
  const cluster = useClusterId();
  const { canEdit } = usePermissions();

  const clusters = useKsqlClusters(cluster);
  const [server, setServer] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!server && clusters.data?.length) setServer(clusters.data[0].name);
  }, [clusters.data, server]);

  const [sql, setSql] = useState(DEFAULT_SQL);
  const [properties, setProperties] = useState<KeyValuePair[]>([
    { key: 'auto.offset.reset', value: 'earliest' },
  ]);
  const [resultTab, setResultTab] = useState<'rows' | 'statement'>('rows');
  const [tab, setTab] = useSearchParamState<'editor' | 'queries'>('tab', 'editor', ksqlTabCodec);
  const [rowLimit, setRowLimit] = useState<number>(KSQL_ROW_LIMITS[1]);
  const [recent, setRecent] = useState<RecentStatement[]>([]);
  const [lastRunMode, setLastRunMode] = useState<'push' | 'pull' | null>(null);
  const [describeTarget, setDescribeTarget] = useState<{
    kind: KsqlObjectKind;
    name: string;
  } | null>(null);

  const streams = useKsqlStreams(cluster, server);
  const tables = useKsqlTables(cluster, server);
  const queries = useKsqlQueries(cluster, server);
  const history = useKsqlHistory(cluster, server);
  const stream = useKsqlQueryStream(cluster, server);
  const statement = useKsqlStatement(cluster, server ?? '');
  const closeQuery = useCloseKsqlQuery(cluster, server ?? '');
  const terminateQuery = useTerminateKsqlQuery(cluster, server ?? '');

  const propertyRecord = useMemo(() => pairsToRecord(properties), [properties]);

  const selectedServer = clusters.data?.find((c) => c.name === server);

  /* Recents live in localStorage, keyed per cluster + server. */
  const storageKey = cluster && server ? recentsKey(cluster, server) : null;
  useEffect(() => {
    setRecent(storageKey ? loadRecents(storageKey) : []);
  }, [storageKey]);

  const remember = useCallback(
    (text: string) =>
      setRecent((prev) => {
        const next = [{ sql: text, ts: Date.now() }, ...prev.filter((s) => s.sql !== text)].slice(
          0,
          RECENTS_MAX,
        );
        if (storageKey) saveRecents(storageKey, next);
        return next;
      }),
    [storageKey],
  );

  const historyItems = useMemo(() => {
    const merged = new Map<string, RecentStatement>();
    for (const item of recent) merged.set(item.sql, item);
    for (const entry of history.data ?? []) {
      const ts = historyTs(entry.ts);
      const existing = merged.get(entry.sql);
      if (!existing || ts > existing.ts) merged.set(entry.sql, { sql: entry.sql, ts });
    }
    return Array.from(merged.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RECENTS_MAX);
  }, [recent, history.data]);

  const runQuery = () => {
    if (!server || !sql.trim()) return;
    remember(sql.trim());
    setResultTab('rows');
    setLastRunMode(classifyKsqlQuery(sql));
    stream.start({ sql: sql.trim(), properties: propertyRecord }, rowLimit);
  };

  /**
   * Stop streaming, then release the server-side query: transient push queries
   * are closed with `/close-query`; if that fails (older servers, persistent id)
   * fall back to `TERMINATE <id>`.
   */
  const stopQuery = async () => {
    const id = stream.queryId;
    stream.stop();
    if (!id) return;
    try {
      await closeQuery.mutateAsync(id);
    } catch {
      try {
        await terminateQuery.mutateAsync(id);
      } catch (e) {
        toastError(`Query ${id} may still be running on the server`, e);
      }
    }
  };

  const clearResults = () => {
    stream.clear();
    statement.reset();
    setLastRunMode(null);
  };

  const runStatement = async () => {
    if (!server || !sql.trim() || !canExecute) return;
    remember(sql.trim());
    setResultTab('statement');
    try {
      await statement.mutateAsync({ sql: sql.trim(), properties: propertyRecord });
      toast.success('Statement executed');
      void streams.refetch();
      void tables.refetch();
      void queries.refetch();
      void history.refetch();
    } catch (e) {
      toastError('Statement failed', e);
    }
  };

  const looksLikeQuery = /^\s*select/i.test(sql);
  const queryMode = classifyKsqlQuery(sql);
  const canExecute = canEdit || isReadOnlyKsqlStatement(sql);
  const executeBlockedReason = canExecute
    ? undefined
    : `${REQUIRES_EDITOR} — viewers may only execute SHOW / LIST / DESCRIBE / EXPLAIN statements`;
  const editorDirty = sql.trim() !== '' && sql !== DEFAULT_SQL;

  if (clusters.error) {
    return (
      <div>
        <PageHeader title="ksqlDB" description="Run queries and manage streams and tables." />
        <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />
      </div>
    );
  }

  if (!clusters.isLoading && (clusters.data?.length ?? 0) === 0) {
    return (
      <div>
        <PageHeader title="ksqlDB" description="Run queries and manage streams and tables." />
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Terminal}
            title="No ksqlDB servers configured"
            description={
              <>
                Add a <span className="font-mono">ksqldb</span> entry to this cluster in{' '}
                <span className="font-mono">k-shui.yaml</span> to use the editor.
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <UnsavedChangesGuard
        dirty={editorDirty}
        description="The statement in the editor will be lost if you leave this page."
      />
      <PageHeader
        title="ksqlDB"
        description="Editor, streams and tables, and running persistent queries."
        meta={
          selectedServer ? (
            <span className="flex items-center gap-1.5">
              <StatusPill status={selectedServer.serverStatus ?? 'unknown'} />
              {selectedServer.version ? (
                <Badge variant="secondary">v{selectedServer.version}</Badge>
              ) : null}
            </span>
          ) : null
        }
        actions={
          clusters.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (clusters.data?.length ?? 0) > 1 ? (
            <SimpleSelect
              value={server}
              onValueChange={setServer}
              options={(clusters.data ?? []).map((c) => ({ label: c.name, value: c.name }))}
              aria-label="ksqlDB server"
              className="w-56"
            />
          ) : (
            <span className="truncate font-mono text-2xs text-[var(--muted)]">
              {selectedServer?.url}
            </span>
          )
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'editor' | 'queries')}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="queries">
            Queries
            {queries.data?.length ? (
              <Badge variant="secondary" size="sm" className="ml-1.5">
                {queries.data.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <Card className="hidden max-h-[calc(100vh-220px)] min-h-0 flex-col p-3 lg:flex">
              <KsqlSidebar
                streams={streams.data}
                tables={tables.data}
                queries={queries.data}
                loading={streams.isLoading || tables.isLoading}
                error={streams.error ?? tables.error}
                onRetry={() => {
                  void streams.refetch();
                  void tables.refetch();
                }}
                selected={describeTarget}
                onSelect={(kind, name) => setDescribeTarget({ kind, name })}
              />
            </Card>

            <div className="min-w-0 space-y-4">
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>Statement</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Settings2 /> Properties
                          {properties.length ? (
                            <Badge variant="secondary" size="sm">
                              {properties.length}
                            </Badge>
                          ) : null}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96">
                        <p className="mb-2 text-xs font-medium">Query properties</p>
                        <KeyValueEditor
                          value={properties}
                          onChange={setProperties}
                          keyPlaceholder="auto.offset.reset"
                          valuePlaceholder="earliest"
                          addLabel="Add property"
                          keySuggestions={PROPERTY_SUGGESTIONS}
                        />
                      </PopoverContent>
                    </Popover>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={historyItems.length === 0}>
                          <History /> History
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-96 w-[420px] overflow-y-auto">
                        <DropdownMenuLabel>Recent statements</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {historyItems.map((item) => (
                          <DropdownMenuItem key={item.sql} onSelect={() => setSql(item.sql)}>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate font-mono text-2xs">
                                {truncate(item.sql.replace(/\s+/g, ' '), 80)}
                              </span>
                              <span className="text-2xs text-[var(--muted)]">
                                {item.ts ? formatRelative(item.ts) : '—'}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <SimpleSelect
                      value={String(rowLimit)}
                      onValueChange={(v) => setRowLimit(Number(v))}
                      options={KSQL_ROW_LIMITS.map((n) => ({
                        label: `keep last ${n.toLocaleString()}`,
                        value: String(n),
                      }))}
                      aria-label="Row buffer limit"
                      className="w-40"
                    />

                    <Button variant="ghost" size="sm" onClick={() => setSql('')}>
                      <Trash2 /> Clear
                    </Button>

                    {stream.streaming ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        loading={closeQuery.isPending || terminateQuery.isPending}
                        onClick={() => void stopQuery()}
                      >
                        <Square /> Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={looksLikeQuery ? 'default' : 'outline'}
                        disabled={!sql.trim() || !server}
                        onClick={runQuery}
                      >
                        <Play /> Run query
                      </Button>
                    )}
                    <Tooltip content={executeBlockedReason}>
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant={looksLikeQuery ? 'outline' : 'default'}
                          loading={statement.isPending}
                          disabled={!sql.trim() || !server || !canExecute}
                          onClick={() => void runStatement()}
                        >
                          <Zap /> Execute
                        </Button>
                      </span>
                    </Tooltip>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <CodeEditor
                    value={sql}
                    onChange={setSql}
                    language="sql"
                    minimal={false}
                    height={220}
                    onSubmit={() => (looksLikeQuery ? runQuery() : void runStatement())}
                    ariaLabel="ksqlDB statement"
                  />
                  <p className="text-2xs text-[var(--muted)]">
                    ⌘/Ctrl+Enter runs the statement. “Run query” streams rows from a push or pull
                    query; “Execute” sends DDL/DML to the ksqlDB server.
                    {queryMode ? (
                      <>
                        {' '}
                        This looks like a{' '}
                        <span className="font-medium text-[var(--foreground)]">
                          {queryMode === 'push' ? 'push (unbounded)' : 'pull'}
                        </span>{' '}
                        query
                        {queryMode === 'push'
                          ? ` — it streams until stopped; only the last ${rowLimit.toLocaleString()} rows are kept.`
                          : '.'}
                      </>
                    ) : null}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between gap-2 pb-0">
                  <Tabs
                    value={resultTab}
                    onValueChange={(v) => setResultTab(v as 'rows' | 'statement')}
                  >
                    <TabsList>
                      <TabsTrigger value="rows">Rows</TabsTrigger>
                      <TabsTrigger value="statement">Statement output</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      stream.streaming ||
                      (stream.rows.length === 0 && stream.columns.length === 0 && !statement.data)
                    }
                    onClick={clearResults}
                  >
                    <Eraser /> Clear results
                  </Button>
                </CardHeader>
                <CardContent className="pt-4">
                  {resultTab === 'rows' ? (
                    <KsqlResultsGrid
                      columns={stream.columns}
                      columnTypes={stream.columnTypes}
                      rows={stream.rows}
                      streaming={stream.streaming}
                      finished={stream.finished}
                      error={stream.error}
                      queryId={stream.queryId}
                      received={stream.received}
                      maxRows={stream.maxRows}
                      queryMode={lastRunMode}
                    />
                  ) : (
                    <KsqlStatementResults
                      results={statement.data as KsqlStatementResult[] | undefined}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="queries">
          <KsqlQueriesTable
            cluster={cluster}
            server={server ?? ''}
            queries={queries.data}
            loading={queries.isLoading}
            error={queries.error}
            onRetry={() => void queries.refetch()}
            onInspect={(query: KsqlQueryInfo) =>
              setDescribeTarget({ kind: 'query', name: query.id })
            }
          />
        </TabsContent>
      </Tabs>

      <KsqlDescribeSheet
        cluster={cluster}
        server={server}
        target={describeTarget}
        queries={queries.data}
        onOpenChange={(open) => !open && setDescribeTarget(null)}
      />
    </div>
  );
}

export default KsqlPage;
