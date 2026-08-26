import { useMemo } from 'react';
import { Download, Table2 } from 'lucide-react';
import { downloadText, toCsv } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';

export interface KsqlResultsGridProps {
  columns: string[];
  columnTypes?: string[];
  rows: unknown[][];
  streaming?: boolean;
  finished?: boolean;
  error?: unknown;
  queryId?: string | null;
  maxHeight?: number;
  /** Total rows received (may exceed `rows.length` once the ring buffer evicts). */
  received?: number;
  /** Ring-buffer cap the run was started with. */
  maxRows?: number;
  /** Push (unbounded, EMIT CHANGES) or pull (bounded) query. */
  queryMode?: 'push' | 'pull' | null;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Streaming result grid for push/pull queries. */
export function KsqlResultsGrid({
  columns,
  columnTypes,
  rows,
  streaming,
  finished,
  error,
  queryId,
  maxHeight = 420,
  received,
  maxRows,
  queryMode,
}: KsqlResultsGridProps) {
  const dropped = received !== undefined && received > rows.length;
  const csvRows = useMemo(
    () =>
      rows.map((row) =>
        Object.fromEntries(columns.map((column, i) => [column, renderCell(row[i])])),
      ),
    [rows, columns],
  );

  const exportCsv = () => {
    downloadText(toCsv(csvRows, columns), `ksql-results-${Date.now()}.csv`, 'text/csv');
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Results</span>
        {queryMode ? (
          <Badge
            variant={queryMode === 'push' ? 'info' : 'secondary'}
            title={
              queryMode === 'push'
                ? 'Push query (EMIT CHANGES / no key predicate): streams until stopped. Rows are kept in a ring buffer.'
                : 'Pull query: returns the current state and completes.'
            }
          >
            {queryMode === 'push' ? 'push (unbounded)' : 'pull'}
          </Badge>
        ) : null}
        <Badge variant="secondary">
          {dropped
            ? `showing last ${rows.length} of ${received} received`
            : `${rows.length} rows${maxRows && rows.length >= maxRows ? ` (limit ${maxRows})` : ''}`}
        </Badge>
        {streaming ? (
          <Badge variant="warning">streaming…</Badge>
        ) : finished ? (
          <Badge variant="success">complete</Badge>
        ) : null}
        {queryId ? (
          <span className="truncate font-mono text-2xs text-[var(--muted)]">{queryId}</span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          <Download /> Export CSV
        </Button>
      </div>

      {error ? <InlineError error={error} /> : null}

      <div
        className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)]"
        style={{ maxHeight }}
      >
        {columns.length === 0 && rows.length === 0 ? (
          <EmptyState
            compact
            icon={Table2}
            title="No results yet"
            description="Run a query to stream rows here."
          />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
              <tr>
                <th className="w-12 border-b border-[var(--border)] px-3 py-2 text-right text-2xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  #
                </th>
                {columns.map((column, index) => (
                  <th
                    key={column}
                    className="border-b border-[var(--border)] px-3 py-2 text-left text-2xs font-medium uppercase tracking-wide text-[var(--muted)]"
                  >
                    <span className="block truncate">{column}</span>
                    {columnTypes?.[index] ? (
                      <span className="block truncate font-mono text-2xs normal-case opacity-70">
                        {columnTypes[index]}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]"
                >
                  <td className="px-3 py-1.5 text-right font-mono text-2xs tabular-nums text-[var(--muted)]">
                    {rowIndex + 1}
                  </td>
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column}
                      className="max-w-md truncate px-3 py-1.5 font-mono text-[12.5px]"
                      title={renderCell(row[columnIndex])}
                    >
                      {renderCell(row[columnIndex])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
