import { CheckCircle2, Terminal, XCircle } from 'lucide-react';
import type { KsqlStatementResult } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { JsonViewer } from '@/components/ui/json-viewer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => Boolean(asRecord(v)))
    : [];
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface KsqlStatementResultsProps {
  results: KsqlStatementResult[] | undefined;
}

/** Renders the `/ksql` statement response array by payload type. */
export function KsqlStatementResults({ results }: KsqlStatementResultsProps) {
  if (!results || results.length === 0) {
    return (
      <EmptyState
        compact
        icon={Terminal}
        title="No statement output"
        description="Run a DDL/DML statement (CREATE, SHOW, DESCRIBE, TERMINATE…) to see its response."
      />
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result, index) => (
        <StatementCard key={index} result={result} />
      ))}
    </div>
  );
}

function StatementCard({ result }: { result: KsqlStatementResult }) {
  const type = String(result['@type'] ?? '').toLowerCase();
  const statement = str(result.statementText);

  const header = (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
      <Badge variant="secondary" size="sm">
        {type || 'response'}
      </Badge>
      {statement ? (
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-[var(--muted)]">
          {statement}
        </span>
      ) : null}
    </div>
  );

  let body: React.ReactNode;

  if (type.includes('currentstatus') || result.commandStatus) {
    const status = asRecord(result.commandStatus);
    const state = str(status?.status);
    const success = state === 'SUCCESS' || state === 'QUEUED';
    body = (
      <div className="flex items-start gap-2 p-3">
        {success ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium">{state || 'UNKNOWN'}</p>
          <p className="break-words text-2xs text-[var(--muted)]">{str(status?.message)}</p>
        </div>
      </div>
    );
  } else if (Array.isArray(result.streams) || Array.isArray(result.tables)) {
    const rows = asArray(result.streams ?? result.tables);
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Topic</TableHead>
            <TableHead>Key format</TableHead>
            <TableHead>Value format</TableHead>
            <TableHead>Windowed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono">{str(row.name)}</TableCell>
              <TableCell className="font-mono text-2xs">{str(row.topic)}</TableCell>
              <TableCell className="text-2xs">{str(row.keyFormat)}</TableCell>
              <TableCell className="text-2xs">{str(row.valueFormat)}</TableCell>
              <TableCell className="text-2xs">{str(row.isWindowed)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (Array.isArray(result.queries)) {
    const rows = asArray(result.queries);
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Query id</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Sinks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono text-2xs">{str(row.id)}</TableCell>
              <TableCell className="text-2xs">{str(row.state)}</TableCell>
              <TableCell className="font-mono text-2xs">{str(row.sinks)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (Array.isArray(result.topics)) {
    const rows = asArray(result.topics);
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Topic</TableHead>
            <TableHead>Partitions</TableHead>
            <TableHead>Replicas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell className="font-mono">{str(row.name)}</TableCell>
              <TableCell className="text-2xs">
                {Array.isArray(row.replicaInfo) ? row.replicaInfo.length : str(row.partitions)}
              </TableCell>
              <TableCell className="text-2xs">{str(row.replicaInfo)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else {
    body = (
      <div className="p-3">
        <JsonViewer value={result} maxHeight={320} defaultExpandedDepth={3} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)]">
      {header}
      {body}
    </div>
  );
}
