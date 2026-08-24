import { useKsqlDescribe } from '@/api/hooks/ksql';
import type { KsqlQueryInfo } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
import { InlineError } from '@/components/ui/error-state';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import type { KsqlObjectKind } from './KsqlSidebar';

export interface KsqlDescribeSheetProps {
  cluster: string;
  server: string | undefined;
  target: { kind: KsqlObjectKind; name: string } | null;
  queries: KsqlQueryInfo[] | undefined;
  onOpenChange: (open: boolean) => void;
}

/** Side panel with `DESCRIBE EXTENDED` output for a stream/table, or query detail. */
export function KsqlDescribeSheet({
  cluster,
  server,
  target,
  queries,
  onOpenChange,
}: KsqlDescribeSheetProps) {
  const isSource = target?.kind === 'stream' || target?.kind === 'table';
  const describe = useKsqlDescribe(
    cluster,
    server,
    isSource ? (target?.kind as 'stream' | 'table') : undefined,
    isSource ? target?.name : undefined,
  );

  const query = target?.kind === 'query' ? queries?.find((q) => q.id === target.name) : undefined;
  const data = describe.data;

  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="flex flex-col">
        <SheetHeader>
          <SheetTitle className="font-mono">{target?.name ?? ''}</SheetTitle>
          <SheetDescription>
            {target?.kind === 'query' ? 'Persistent query' : `DESCRIBE EXTENDED ${target?.kind}`}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {target?.kind === 'query' ? (
            query ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={query.state ?? 'unknown'} />
                  {query.sinks?.map((sink) => (
                    <Badge key={sink} variant="secondary" className="font-mono">
                      {sink}
                    </Badge>
                  ))}
                </div>
                <CodeBlock code={query.queryString} language="sql" maxHeight={420} wrap />
              </>
            ) : (
              <p className="text-xs text-[var(--muted)]">Query is no longer running.</p>
            )
          ) : describe.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : describe.error ? (
            <InlineError error={describe.error} onRetry={() => void describe.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Topic" value={data?.topic ?? '—'} mono />
                <Field label="Type" value={data?.type ?? target?.kind ?? '—'} />
                <Field label="Key format" value={data?.keyFormat ?? '—'} />
                <Field label="Value format" value={data?.valueFormat ?? '—'} />
                <Field label="Partitions" value={String(data?.partitions ?? '—')} mono />
                <Field label="Replication" value={String(data?.replication ?? '—')} mono />
              </div>

              <section>
                <h3 className="mb-2 text-xs font-semibold">Schema</h3>
                {data?.fields?.length ? (
                  <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.fields.map((field) => (
                          <TableRow key={field.name}>
                            <TableCell className="font-mono text-2xs">{field.name}</TableCell>
                            <TableCell className="font-mono text-2xs text-[var(--muted)]">
                              {field.type ?? field.schema?.type ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)]">No field information returned.</p>
                )}
              </section>

              {data?.statement ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold">Statement</h3>
                  <CodeBlock code={data.statement} language="sql" maxHeight={240} wrap />
                </section>
              ) : null}

              {data?.readQueries?.length || data?.writeQueries?.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold">Queries</h3>
                  {[...(data.writeQueries ?? []), ...(data.readQueries ?? [])].map((q) => (
                    <div
                      key={q.id}
                      className="rounded-[var(--radius-control)] border border-[var(--border)] p-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-2xs">{q.id}</span>
                        <StatusPill status={q.state ?? 'unknown'} />
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={mono ? 'truncate font-mono text-[13px]' : 'truncate text-[13px]'}>{value}</p>
    </div>
  );
}
