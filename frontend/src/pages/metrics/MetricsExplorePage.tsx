import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Compass, Play, Plus } from 'lucide-react';
import {
  useDashboardList,
  useDashboardSpec,
  useMetricCatalog,
  usePromInstant,
  usePromRange,
  useUpdateDashboard,
} from '@/api/hooks/metrics';
import type { TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { formatDecimal, formatTimestamp } from '@/lib/format';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
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
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { SimpleSelect } from '@/components/ui/select';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import {
  newPanelId,
  PANEL_TYPES,
  PANEL_UNITS,
  promMatrixToSeries,
  promSeriesName,
} from './panelUtils';

export function MetricsExplorePage() {
  const cluster = useClusterId();
  const [params, setParams] = useSearchParams();

  const [expr, setExpr] = useState(params.get('q') ?? '');
  const [submitted, setSubmitted] = useState(params.get('q') ?? '');
  const [range, setRange] = useState<TimeRange>((params.get('range') as TimeRange) ?? '1h');
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [metricSearch, setMetricSearch] = useState('');
  const debouncedSearch = useDebounced(metricSearch, 250);

  const catalog = useMetricCatalog(cluster, debouncedSearch || undefined);
  const rangeQuery = usePromRange(cluster, submitted, { range }, view === 'graph');
  const instantQuery = usePromInstant(cluster, submitted, view === 'table');

  const dashboards = useDashboardList(cluster);
  const [addOpen, setAddOpen] = useState(false);
  const [targetDashboard, setTargetDashboard] = useState<string>('');
  const [panelTitle, setPanelTitle] = useState('');
  const [panelType, setPanelType] = useState('timeseries');
  const [panelUnitValue, setPanelUnitValue] = useState('short');
  const targetSpec = useDashboardSpec(
    cluster,
    addOpen && targetDashboard ? targetDashboard : undefined,
  );
  const update = useUpdateDashboard(cluster);

  const userDashboards = useMemo(
    () => (dashboards.data ?? []).filter((d) => !d.builtin),
    [dashboards.data],
  );

  useEffect(() => {
    if (addOpen && !targetDashboard && userDashboards.length > 0) {
      setTargetDashboard(userDashboards[0].id);
    }
  }, [addOpen, targetDashboard, userDashboards]);

  const series = useMemo(() => promMatrixToSeries(rangeQuery.data?.result), [rangeQuery.data]);

  const run = () => {
    const q = expr.trim();
    setSubmitted(q);
    setParams(q ? { q, range } : {}, { replace: true });
  };

  const metricOptions = useMemo(
    () =>
      (catalog.data ?? []).slice(0, 500).map((m) => ({
        label: m.name,
        value: m.name,
        description: m.help ?? undefined,
      })),
    [catalog.data],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Explore"
        description="Run ad-hoc PromQL against this cluster's Prometheus."
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/c/${cluster}/metrics`}>
                <ArrowLeft /> Dashboards
              </Link>
            </Button>
            <TimeRangePicker value={range} onValueChange={setRange} size="sm" />
            <RefreshPicker
              onRefresh={() => {
                void rangeQuery.refetch();
                void instantQuery.refetch();
              }}
              refreshing={rangeQuery.isFetching || instantQuery.isFetching}
            />
          </>
        }
      />

      <Card>
        <CardToolbarHeader
          title="Query"
          description="Ctrl/⌘ + Enter runs the query"
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!submitted}
                onClick={() => {
                  setPanelTitle(submitted.slice(0, 60));
                  setAddOpen(true);
                }}
              >
                <Plus /> Add to dashboard
              </Button>
              <Button size="sm" onClick={run} loading={rangeQuery.isFetching && view === 'graph'}>
                <Play /> Run
              </Button>
            </>
          }
        />
        <CardContent className="space-y-3">
          <Combobox
            className="w-full max-w-xl"
            options={metricOptions}
            value={null}
            onValueChange={(v) => v && setExpr((e) => (e ? `${e}${v}` : v))}
            placeholder="Browse metric catalog…"
            searchPlaceholder="Search metric names…"
            emptyText={catalog.isLoading ? 'Loading…' : 'No metrics found'}
            onSearchChange={setMetricSearch}
            loading={catalog.isLoading}
          />
          <Textarea
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                run();
              }
            }}
            rows={4}
            placeholder='sum by (topic) (rate(kafka_server_brokertopicmetrics_bytesin_total{topic!=""}[5m]))'
            className="font-mono text-xs"
            aria-label="PromQL expression"
          />
        </CardContent>
      </Card>

      <Card>
        <CardToolbarHeader
          title="Result"
          description={submitted || 'No query yet'}
          actions={
            <>
              {series.length > 0 ? <Badge variant="secondary">{series.length} series</Badge> : null}
              <Tabs value={view} onValueChange={(v) => setView(v as 'graph' | 'table')}>
                <SegmentedList>
                  <SegmentedTrigger value="graph">Graph</SegmentedTrigger>
                  <SegmentedTrigger value="table">Table</SegmentedTrigger>
                </SegmentedList>
              </Tabs>
            </>
          }
        />
        <CardContent>
          {!submitted ? (
            <EmptyState
              icon={Compass}
              title="Run a query"
              description="Pick a metric from the catalog or type a PromQL expression, then press Run."
            />
          ) : view === 'graph' ? (
            rangeQuery.error ? (
              <InlineError error={rangeQuery.error} onRetry={() => void rangeQuery.refetch()} />
            ) : (
              <TimeSeriesChart
                series={series}
                loading={rangeQuery.isLoading}
                unit="count"
                height={340}
                area={false}
                emptyMessage="The query returned no samples for this range."
              />
            )
          ) : instantQuery.error ? (
            <InlineError error={instantQuery.error} onRetry={() => void instantQuery.refetch()} />
          ) : (instantQuery.data?.result?.length ?? 0) === 0 ? (
            <EmptyState compact title="No results" description="The query returned no series." />
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Series</TableHead>
                    <TableHead numeric>Value</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(instantQuery.data?.result ?? []).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-xl truncate font-mono text-2xs">
                        {promSeriesName(r.metric)}
                      </TableCell>
                      <TableCell numeric>{formatDecimal(Number(r.value[1]))}</TableCell>
                      <TableCell className="font-mono text-2xs text-[var(--muted)]">
                        {formatTimestamp(r.value[0] * 1000)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add to dashboard</DialogTitle>
            <DialogDescription>
              Appends this query as a new panel on one of your dashboards.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {userDashboards.length === 0 ? (
              <EmptyState
                compact
                title="No editable dashboards"
                description="Built-in dashboards cannot be modified — create your own first."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/c/${cluster}/metrics`}>Go to dashboards</Link>
                  </Button>
                }
              />
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Dashboard</Label>
                  <SimpleSelect
                    value={targetDashboard}
                    onValueChange={setTargetDashboard}
                    options={userDashboards.map((d) => ({ label: d.title, value: d.id }))}
                    aria-label="Dashboard"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="explore-panel-title">Panel title</Label>
                  <Input
                    id="explore-panel-title"
                    value={panelTitle}
                    onChange={(e) => setPanelTitle(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Visualization</Label>
                    <SimpleSelect
                      value={panelType}
                      onValueChange={setPanelType}
                      options={PANEL_TYPES}
                      aria-label="Visualization"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit</Label>
                    <SimpleSelect
                      value={panelUnitValue}
                      onValueChange={setPanelUnitValue}
                      options={PANEL_UNITS}
                      aria-label="Unit"
                    />
                  </div>
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={userDashboards.length === 0 || !targetSpec.data || !panelTitle.trim()}
              loading={update.isPending}
              onClick={() => {
                const spec = targetSpec.data;
                if (!spec) return;
                const rows =
                  spec.rows.length > 0 ? [...spec.rows] : [{ title: 'Row 1', panels: [] }];
                const ids = rows.flatMap((r) => r.panels.map((p) => p.id));
                const last = rows.length - 1;
                rows[last] = {
                  ...rows[last],
                  panels: [
                    ...rows[last].panels,
                    {
                      id: newPanelId(ids),
                      title: panelTitle.trim(),
                      type: panelType,
                      unit: panelUnitValue,
                      queries: [{ expr: submitted, legend: '' }],
                    },
                  ],
                };
                update.mutate(
                  {
                    id: spec.id,
                    title: spec.title,
                    description: spec.description ?? '',
                    tags: spec.tags ?? [],
                    variables: spec.variables ?? [],
                    rows,
                  },
                  {
                    onSuccess: () => {
                      toast.success('Panel added');
                      setAddOpen(false);
                    },
                    onError: (e) => toastError('Could not add panel', e),
                  },
                );
              }}
            >
              Add panel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MetricsExplorePage;
