import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  CircleStop,
  Eraser,
  Play,
  Plug,
  PlugZap,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useFlinkSqlActions, useFlinkSqlSupport } from '@/api/hooks/flink';
import type { FlinkSqlResult, FlinkSqlResultColumn } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { CodeEditor } from '@/components';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
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

const SAMPLE = `-- Flink SQL
SHOW TABLES;`;

const MAX_ROWS = 500;

interface ResultState {
  columns: FlinkSqlResultColumn[];
  rows: unknown[][];
  kind: string | null;
  done: boolean;
}

const EMPTY: ResultState = { columns: [], rows: [], kind: null, done: false };

function readColumns(result: FlinkSqlResult): FlinkSqlResultColumn[] {
  return result.results?.columns ?? result.results?.columnInfos ?? [];
}

export function FlinkSqlPage() {
  const cluster = useClusterId();
  const { fc = '' } = useParams<{ fc: string }>();
  const base = `/c/${cluster}/flink/${encodeURIComponent(fc)}`;

  const support = useFlinkSqlSupport(cluster, fc);
  const { openSession, closeSession, submit, poll } = useFlinkSqlActions(cluster, fc);

  const [sql, setSql] = useState(SAMPLE);
  const [session, setSession] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResultState>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const s = await openSession();
      const handle = s.sessionHandle ?? (s as unknown as { sessionHandleId?: string }).sessionHandleId;
      setSession(handle ?? null);
      toast.success('SQL session opened');
    } catch (e) {
      setError(e);
      toastError('Could not open session', e);
    } finally {
      setConnecting(false);
    }
  }, [openSession]);

  const disconnect = useCallback(async () => {
    if (!session) return;
    try {
      await closeSession(session);
      toast.success('Session closed');
    } catch (e) {
      toastError('Could not close session', e);
    } finally {
      setSession(null);
      setResult(EMPTY);
    }
  }, [closeSession, session]);

  const run = useCallback(async () => {
    if (!sql.trim()) return;
    let handle = session;
    setError(null);
    setResult(EMPTY);
    setRunning(true);
    try {
      if (!handle) {
        const s = await openSession();
        handle = s.sessionHandle ?? null;
        setSession(handle);
      }
      if (!handle) throw new Error('No SQL session available');

      const op = await submit(handle, sql.trim());
      const operation =
        op.operationHandle ?? (op as unknown as { operationHandleId?: string }).operationHandleId;
      if (!operation) throw new Error('Gateway did not return an operation handle');

      let token = 0;
      const columns: FlinkSqlResultColumn[] = [];
      const rows: unknown[][] = [];
      let kind: string | null = null;

      for (let i = 0; i < 600; i += 1) {
        if (cancelRef.current) break;
        const page: FlinkSqlResult = await poll(handle, operation, token);
        if (page.errors?.length) throw new Error(page.errors.join('\n'));
        if (columns.length === 0) columns.push(...readColumns(page));
        kind = page.resultKind ?? kind;
        for (const row of page.results?.data ?? []) {
          if (rows.length >= MAX_ROWS) break;
          rows.push((row.fields ?? []) as unknown[]);
        }
        setResult({ columns: [...columns], rows: [...rows], kind, done: false });

        const type = (page.resultType ?? '').toUpperCase();
        if (type === 'EOS' || rows.length >= MAX_ROWS) break;
        if (type === 'NOT_READY') {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        token += 1;
        await new Promise((r) => setTimeout(r, 150));
      }

      setResult({ columns, rows, kind, done: true });
    } catch (e) {
      setError(e);
      toastError('Statement failed', e);
    } finally {
      setRunning(false);
    }
  }, [openSession, poll, session, sql, submit]);

  if (support.isLoading) {
    return (
      <div>
        <PageHeader title="Flink SQL" description={fc} />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (support.error || support.data?.supported === false) {
    return (
      <div>
        <PageHeader
          title="Flink SQL"
          description={fc}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={base}>
                <ArrowLeft /> Cluster
              </Link>
            </Button>
          }
        />
        <Card>
          <EmptyState
            icon={PlugZap}
            title="SQL Gateway not configured"
            description={
              support.data?.reason ??
              'Set `sqlGatewayUrl` on this Flink cluster in k-shui.yaml to run SQL statements from here.'
            }
            action={
              <Button asChild variant="outline">
                <Link to={`/c/${cluster}/settings`}>Cluster settings</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Flink SQL"
        description={`Run statements against the ${fc} SQL gateway`}
        meta={
          session ? (
            <Badge variant="success">session {session.slice(0, 8)}…</Badge>
          ) : (
            <Badge variant="secondary">no session</Badge>
          )
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={base}>
                <ArrowLeft /> Cluster
              </Link>
            </Button>
            {session ? (
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                <CircleStop /> Close session
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                loading={connecting}
                onClick={() => void connect()}
              >
                <Plug /> Open session
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardToolbarHeader
          title="Editor"
          description="Ctrl/⌘ + Enter runs the statement"
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setSql('')}>
                <Eraser /> Clear
              </Button>
              <Button size="sm" loading={running} onClick={() => void run()}>
                <Play /> Run
              </Button>
            </>
          }
        />
        <CardContent>
          <div
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
          >
            <CodeEditor value={sql} onChange={setSql} language="sql" height={240} minimal={false} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardToolbarHeader
          title="Results"
          description={
            result.rows.length > 0
              ? `${result.rows.length}${result.rows.length >= MAX_ROWS ? '+' : ''} rows`
              : undefined
          }
          actions={
            <>
              {result.kind ? <Badge variant="secondary">{result.kind}</Badge> : null}
              {result.rows.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setResult(EMPTY)}>
                  <Trash2 /> Clear
                </Button>
              ) : null}
            </>
          }
        />
        <CardContent>
          {error ? (
            <InlineError error={error} />
          ) : running && result.rows.length === 0 ? (
            <Skeleton className="h-40 w-full" />
          ) : result.columns.length === 0 ? (
            <EmptyState
              compact
              icon={Terminal}
              title="No results yet"
              description="Run a statement to see its result set here."
            />
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="hover:bg-transparent">
                    {result.columns.map((c, i) => (
                      <TableHead key={`${c.name}-${i}`}>{c.name}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, ri) => (
                    <TableRow key={ri}>
                      {result.columns.map((_c, ci) => (
                        <TableCell key={ci} className="font-mono text-2xs">
                          {row[ci] === null || row[ci] === undefined
                            ? '—'
                            : typeof row[ci] === 'object'
                              ? JSON.stringify(row[ci])
                              : String(row[ci])}
                        </TableCell>
                      ))}
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

export default FlinkSqlPage;
