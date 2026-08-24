import {
  useFlinkVertexBackpressure,
  useFlinkVertexSubtasks,
  useFlinkVertexWatermarks,
} from '@/api/hooks/flink';
import type { FlinkVertexDetail } from '@/api/types';
import { formatBytes, formatCompact, formatDuration, formatDecimal } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { cleanPlanDescription, flinkStateTone, ratioPct } from '../flinkLib';
import { UsageBar } from './TaskStatusBar';

export interface VertexPanelProps {
  cluster: string;
  flinkCluster: string;
  jid: string;
  vertex: FlinkVertexDetail | null;
  description?: string | null;
  onOpenChange: (open: boolean) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function VertexPanel({
  cluster,
  flinkCluster,
  jid,
  vertex,
  description,
  onOpenChange,
}: VertexPanelProps) {
  const id = vertex?.id;
  const subtasks = useFlinkVertexSubtasks(cluster, flinkCluster, jid, id);
  const backpressure = useFlinkVertexBackpressure(cluster, flinkCluster, jid, id);
  const watermarks = useFlinkVertexWatermarks(cluster, flinkCluster, jid, id);

  const m = vertex?.metrics;
  const busyPct = ratioPct(m?.accumulatedBusyTime, vertex?.duration);
  const bpPct = ratioPct(m?.accumulatedBackpressuredTime, vertex?.duration);

  return (
    <Sheet open={Boolean(vertex)} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="flex flex-col">
        <SheetHeader>
          <SheetTitle className="pr-4 text-sm leading-5">{vertex?.name}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2">
            {vertex ? (
              <StatusPill
                status={vertex.status}
                tone={flinkStateTone(vertex.status)}
                label={vertex.status.toLowerCase()}
              />
            ) : null}
            <Badge variant="secondary">parallelism {vertex?.parallelism ?? '—'}</Badge>
            {vertex ? (
              <span className="inline-flex items-center gap-1 font-mono text-2xs text-[var(--muted)]">
                {vertex.id.slice(0, 12)}…
                <CopyButton value={vertex.id} tooltip="Copy vertex id" />
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <Section title="Throughput">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Records in', value: formatCompact(m?.readRecords) },
                { label: 'Records out', value: formatCompact(m?.writeRecords) },
                { label: 'Bytes in', value: formatBytes(m?.readBytes) },
                { label: 'Bytes out', value: formatBytes(m?.writeBytes) },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-[var(--radius-control)] bg-[var(--surface-2)] p-3"
                >
                  <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">{s.label}</p>
                  <p className="font-mono text-base font-semibold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Busy / backpressure">
            <div className="space-y-3">
              <UsageBar
                label="Busy"
                used={busyPct ?? 0}
                total={100}
                format={(v) => `${formatDecimal(v)}%`}
                tone={busyPct !== null && busyPct > 80 ? 'warning' : 'primary'}
              />
              <UsageBar
                label="Backpressured"
                used={bpPct ?? 0}
                total={100}
                format={(v) => `${formatDecimal(v)}%`}
                tone={bpPct !== null && bpPct > 10 ? 'danger' : 'primary'}
              />
              {backpressure.error ? (
                <InlineError error={backpressure.error} />
              ) : backpressure.data ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      backpressure.data.backpressureLevel === 'ok'
                        ? 'success'
                        : backpressure.data.backpressureLevel === 'low'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    level {backpressure.data.backpressureLevel}
                  </Badge>
                  {backpressure.data.subtasks?.map((s) => (
                    <span
                      key={s.subtask}
                      className="font-mono text-2xs text-[var(--muted)]"
                      title={`busy ${formatDecimal(s.busyRatio * 100)}% · idle ${formatDecimal(
                        s.idleRatio * 100,
                      )}%`}
                    >
                      #{s.subtask} {formatDecimal(s.ratio * 100)}%
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Watermarks">
            {watermarks.isLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : watermarks.error ? (
              <InlineError error={watermarks.error} />
            ) : (watermarks.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                No watermarks reported for this vertex (no event-time source).
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {watermarks.data?.map((w) => (
                  <span
                    key={w.id}
                    className="rounded-[var(--radius-control)] bg-[var(--surface-2)] px-2 py-1 font-mono text-2xs tabular-nums"
                  >
                    #{w.id}: {w.value}
                  </span>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Subtasks (${subtasks.data?.subtasks?.length ?? 0})`}>
            {subtasks.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : subtasks.error ? (
              <InlineError error={subtasks.error} onRetry={() => void subtasks.refetch()} />
            ) : (subtasks.data?.subtasks?.length ?? 0) === 0 ? (
              <EmptyState compact title="No subtasks" />
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead numeric>In</TableHead>
                      <TableHead numeric>Out</TableHead>
                      <TableHead numeric>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subtasks.data?.subtasks.map((s) => (
                      <TableRow key={`${s.subtask}-${s.attempt}`}>
                        <TableCell className="font-mono tabular-nums">{s.subtask}</TableCell>
                        <TableCell>
                          <StatusPill
                            status={s.status}
                            tone={flinkStateTone(s.status)}
                            label={s.status.toLowerCase()}
                          />
                        </TableCell>
                        <TableCell className="truncate font-mono text-2xs text-[var(--muted)]">
                          {s.host}
                        </TableCell>
                        <TableCell numeric>{formatCompact(s.metrics?.readRecords)}</TableCell>
                        <TableCell numeric>{formatCompact(s.metrics?.writeRecords)}</TableCell>
                        <TableCell numeric>{formatDuration(s.duration)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {description ? (
            <Section title="Operator chain">
              <pre className="overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-2xs leading-5 text-[var(--muted)]">
                {cleanPlanDescription(description)}
              </pre>
            </Section>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
