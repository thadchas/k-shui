import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from 'lucide-react';
import {
  useFlinkJobMetricNames,
  useFlinkJobMetricValues,
  useFlinkVertexMetricNames,
  useFlinkVertexMetricValues,
} from '@/api/hooks/flink';
import type { FlinkJobDetailFull, FlinkMetricEntry, Series } from '@/api/types';
import { inferUnit } from '@/lib/charts';
import { formatDecimal } from '@/lib/format';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { MultiCombobox } from '@/components/ui/combobox';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { shortVertexName } from '../flinkLib';

const DEFAULTS = ['numRecordsInPerSecond', 'numRecordsOutPerSecond', 'busyTimeMsPerSecond'];
const MAX_POINTS = 120;
const POLL_MS = 5000;

/** Keeps a rolling in-memory window of polled metric values. */
function useMetricBuffer(entries: FlinkMetricEntry[] | undefined, resetKey: string): Series[] {
  const bufferRef = useRef<Map<string, [number, number][]>>(new Map());
  const keyRef = useRef(resetKey);
  const [, force] = useState(0);

  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    bufferRef.current = new Map();
  }

  useEffect(() => {
    if (!entries || entries.length === 0) return;
    const ts = Date.now();
    for (const entry of entries) {
      const value = Number(entry.value);
      if (!Number.isFinite(value)) continue;
      const points = bufferRef.current.get(entry.id) ?? [];
      points.push([ts, value]);
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
      bufferRef.current.set(entry.id, points);
    }
    force((n) => n + 1);
  }, [entries]);

  return useMemo(
    () =>
      Array.from(bufferRef.current.entries()).map(([name, points]) => ({
        name,
        points,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, resetKey],
  );
}

export interface JobMetricsTabProps {
  cluster: string;
  flinkCluster: string;
  jid: string;
  job: FlinkJobDetailFull | undefined;
}

export function JobMetricsTab({ cluster, flinkCluster, jid, job }: JobMetricsTabProps) {
  const vertices = job?.vertices ?? [];
  const [scope, setScope] = useState<string>('');
  const effectiveScope = scope || (vertices[0]?.id ?? 'job');
  const isJobScope = effectiveScope === 'job';

  const jobNames = useFlinkJobMetricNames(cluster, flinkCluster, isJobScope ? jid : undefined);
  const vertexNames = useFlinkVertexMetricNames(
    cluster,
    flinkCluster,
    jid,
    isJobScope ? undefined : effectiveScope,
  );
  const namesQuery = isJobScope ? jobNames : vertexNames;

  const available = useMemo(
    () => (namesQuery.data ?? []).map((m) => m.id).sort((a, b) => a.localeCompare(b)),
    [namesQuery.data],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched || available.length === 0) return;
    const defaults = DEFAULTS.filter((d) => available.includes(d));
    setSelected(defaults.length > 0 ? defaults : available.slice(0, 3));
  }, [available, touched]);

  useEffect(() => {
    setTouched(false);
    setSelected([]);
  }, [effectiveScope]);

  const jobValues = useFlinkJobMetricValues(
    cluster,
    flinkCluster,
    isJobScope ? jid : undefined,
    isJobScope ? selected : [],
    POLL_MS,
  );
  const vertexValues = useFlinkVertexMetricValues(
    cluster,
    flinkCluster,
    jid,
    isJobScope ? undefined : effectiveScope,
    isJobScope ? [] : selected,
    POLL_MS,
  );
  const valuesQuery = isJobScope ? jobValues : vertexValues;

  const series = useMetricBuffer(valuesQuery.data, `${effectiveScope}:${selected.join(',')}`);
  const unit = useMemo(() => inferUnit(selected[0] ?? ''), [selected]);

  const scopeOptions = [
    { label: 'Job (aggregate)', value: 'job' },
    ...vertices.map((v) => ({ label: shortVertexName(v.name, 44), value: v.id })),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardToolbarHeader
          title="Live metrics"
          description={`Polled every ${POLL_MS / 1000}s from the Flink REST API`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SimpleSelect
                size="sm"
                className="w-56"
                value={effectiveScope}
                onValueChange={setScope}
                options={scopeOptions}
                aria-label="Metric scope"
              />
              <MultiCombobox
                className="w-64"
                options={available.map((n) => ({ label: n, value: n }))}
                values={selected}
                onValuesChange={(v) => {
                  setTouched(true);
                  setSelected(v);
                }}
                placeholder="Pick metrics…"
                searchPlaceholder="Search metrics…"
                emptyText="No metrics"
                summary={(v) => `${v.length} metric${v.length === 1 ? '' : 's'}`}
              />
            </div>
          }
        />
        <CardContent className="space-y-3">
          {namesQuery.error ? (
            <InlineError error={namesQuery.error} onRetry={() => void namesQuery.refetch()} />
          ) : null}
          {namesQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : selected.length === 0 ? (
            <EmptyState
              compact
              icon={LineChart}
              title="No metrics selected"
              description="Pick one or more metrics to start charting."
            />
          ) : series.every((s) => s.points.length < 2) ? (
            <div className="flex h-64 items-center justify-center">
              <EmptyState
                compact
                icon={LineChart}
                title="Collecting samples…"
                description="The chart fills in as values are polled."
              />
            </div>
          ) : (
            <TimeSeriesChart series={series} unit={unit} height={280} area={false} />
          )}
          {valuesQuery.error ? <InlineError error={valuesQuery.error} /> : null}
        </CardContent>
      </Card>

      {selected.length > 0 ? (
        <Card>
          <CardToolbarHeader
            title="Current values"
            actions={<Badge variant="secondary">{selected.length}</Badge>}
          />
          <CardContent>
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Metric</TableHead>
                    <TableHead numeric>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.map((name) => {
                    const entry = valuesQuery.data?.find((e) => e.id === name);
                    const num = Number(entry?.value);
                    return (
                      <TableRow key={name}>
                        <TableCell className="font-mono text-2xs">{name}</TableCell>
                        <TableCell numeric>
                          {entry?.value === undefined
                            ? '—'
                            : Number.isFinite(num)
                              ? formatDecimal(num)
                              : entry.value}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
