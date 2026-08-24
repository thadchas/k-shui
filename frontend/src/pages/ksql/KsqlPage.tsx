import { useEffect, useMemo, useState } from 'react';
import { History, Play, Settings2, Square, Terminal, Trash2, Zap } from 'lucide-react';
import {
  useKsqlClusters,
  useKsqlHistory,
  useKsqlQueries,
  useKsqlQueryStream,
  useKsqlStatement,
  useKsqlStreams,
  useKsqlTables,
} from '@/api/hooks/ksql';
import type { KsqlQueryInfo, KsqlStatementResult } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { truncate } from '@/lib/format';
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
import { KsqlDescribeSheet } from './components/KsqlDescribeSheet';
import { KsqlQueriesTable } from './components/KsqlQueriesTable';
import { KsqlResultsGrid } from './components/KsqlResultsGrid';
import { KsqlSidebar, type KsqlObjectKind } from './components/KsqlSidebar';
import { KsqlStatementResults } from './components/KsqlStatementResults';

const DEFAULT_SQL = 'SHOW STREAMS;';

const PROPERTY_SUGGESTIONS = [
  'auto.offset.reset',
  'ksql.streams.auto.offset.reset',
  'processing.guarantee',
  'ksql.query.pull.table.scan.enabled',
  'cache.max.bytes.buffering',
];

export function KsqlPage() {
  const cluster = useClusterId();

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
  const [tab, setTab] = useState<'editor' | 'queries'>('editor');
  const [recent, setRecent] = useState<string[]>([]);
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

  const propertyRecord = useMemo(() => pairsToRecord(properties), [properties]);

  const selectedServer = clusters.data?.find((c) => c.name === server);

  const historyItems = useMemo(() => {
    const fromServer = (history.data ?? []).map((entry) => entry.sql);
    return Array.from(new Set([...recent, ...fromServer])).slice(0, 25);
  }, [recent, history.data]);

  const remember = (text: string) =>
    setRecent((prev) => [text, ...prev.filter((s) => s !== text)].slice(0, 25));

  const runQuery = () => {
    if (!server || !sql.trim()) return;
    remember(sql.trim());
    setResultTab('rows');
    stream.start({ sql: sql.trim(), properties: propertyRecord });
  };

  const runStatement = async () => {
    if (!server || !sql.trim()) return;
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
                        {historyItems.map((item, index) => (
                          <DropdownMenuItem key={index} onSelect={() => setSql(item)}>
                            <span className="truncate font-mono text-2xs">
                              {truncate(item.replace(/\s+/g, ' '), 80)}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button variant="ghost" size="sm" onClick={() => setSql('')}>
                      <Trash2 /> Clear
                    </Button>

                    {stream.streaming ? (
                      <Button variant="destructive" size="sm" onClick={stream.stop}>
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
                    <Button
                      size="sm"
                      variant={looksLikeQuery ? 'outline' : 'default'}
                      loading={statement.isPending}
                      disabled={!sql.trim() || !server}
                      onClick={() => void runStatement()}
                    >
                      <Zap /> Execute
                    </Button>
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
