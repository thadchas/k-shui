import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Pencil,
  Plus,
  Save,
  X,
} from 'lucide-react';
import {
  useDashboardPanelData,
  useDashboardSpec,
  useMetricCatalog,
  useUpdateDashboard,
} from '@/api/hooks/metrics';
import type { DashboardPanelSpec, DashboardRowSpec, TimeRange } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshPicker } from '@/components/ui/refresh-picker';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { toast, toastError } from '@/components/ui/toast';
import { Panel } from './components/Panel';
import { PanelEditor } from './components/PanelEditor';
import { newPanelId, panelGeometry } from './panelUtils';

const SPAN_CLASS: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

export function MetricsDashboardPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const { dashboard: dashboardId = '' } = useParams<{ dashboard: string }>();
  const [params, setParams] = useSearchParams();

  const [range, setRange] = useState<TimeRange>('1h');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [draftRows, setDraftRows] = useState<DashboardRowSpec[] | null>(null);
  const [editorTarget, setEditorTarget] = useState<{
    rowIndex: number;
    panel: DashboardPanelSpec | null;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState<DashboardPanelSpec | null>(null);

  const spec = useDashboardSpec(cluster, dashboardId);
  const data = useDashboardPanelData(cluster, dashboardId, { range }, vars);
  const catalog = useMetricCatalog(cluster);
  const update = useUpdateDashboard(cluster);

  const isBuiltin = spec.data?.builtin ?? false;
  const specRows = spec.data?.rows;
  const rows = useMemo(() => draftRows ?? specRows ?? [], [draftRows, specRows]);

  useEffect(() => {
    const variables = spec.data?.variables ?? [];
    if (variables.length === 0) return;
    setVars((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of variables) {
        if (next[v.name] === undefined) {
          next[v.name] = v.value ?? v.options?.[0] ?? '';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [spec.data?.variables]);

  const startEditing = useCallback(() => {
    setDraftRows((spec.data?.rows ?? []).map((r) => ({ ...r, panels: [...r.panels] })));
    setEditing(true);
    setParams({ edit: '1' }, { replace: true });
  }, [spec.data?.rows, setParams]);

  const stopEditing = useCallback(() => {
    setDraftRows(null);
    setEditing(false);
    setParams({}, { replace: true });
  }, [setParams]);

  useEffect(() => {
    if (editing && draftRows === null && spec.data && !isBuiltin) {
      setDraftRows(spec.data.rows.map((r) => ({ ...r, panels: [...r.panels] })));
    }
  }, [editing, draftRows, spec.data, isBuiltin]);

  const movePanel = (rowIndex: number, panelIndex: number, direction: -1 | 1) => {
    setDraftRows((prev) => {
      if (!prev) return prev;
      const next = prev.map((r) => ({ ...r, panels: [...r.panels] }));
      const panels = next[rowIndex].panels;
      const target = panelIndex + direction;
      if (target < 0 || target >= panels.length) return prev;
      [panels[panelIndex], panels[target]] = [panels[target], panels[panelIndex]];
      return next;
    });
  };

  const removePanel = (rowIndex: number, panelIndex: number) =>
    setDraftRows((prev) => {
      if (!prev) return prev;
      const next = prev.map((r) => ({ ...r, panels: [...r.panels] }));
      next[rowIndex].panels.splice(panelIndex, 1);
      return next;
    });

  const savePanel = (rowIndex: number, panel: DashboardPanelSpec) =>
    setDraftRows((prev) => {
      const source = prev ?? (spec.data?.rows ?? []).map((r) => ({ ...r, panels: [...r.panels] }));
      const next = source.map((r) => ({ ...r, panels: [...r.panels] }));
      if (!next[rowIndex]) next[rowIndex] = { title: 'Row 1', panels: [] };
      const existing = next[rowIndex].panels.findIndex((p) => p.id === panel.id);
      if (existing >= 0) next[rowIndex].panels[existing] = panel;
      else next[rowIndex].panels.push(panel);
      return next;
    });

  const allPanelIds = useMemo(
    () => rows.flatMap((r) => r.panels.map((p) => p.id)),
    [rows],
  );

  const metricNames = useMemo(() => (catalog.data ?? []).map((m) => m.name), [catalog.data]);

  if (spec.error) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to={`/c/${cluster}/metrics`}>
                <ArrowLeft /> Dashboards
              </Link>
            </Button>
          }
        />
        <ErrorState error={spec.error} onRetry={() => void spec.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={spec.data?.title ?? dashboardId}
        description={spec.data?.description || undefined}
        meta={
          <div className="flex items-center gap-2">
            {isBuiltin ? <Badge variant="secondary">built-in</Badge> : null}
            {(spec.data?.tags ?? []).map((t) => (
              <Badge key={t} variant="outline" size="sm">
                {t}
              </Badge>
            ))}
          </div>
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={`/c/${cluster}/metrics`}>
                <ArrowLeft /> Dashboards
              </Link>
            </Button>
            {(spec.data?.variables ?? []).map((v) => (
              <SimpleSelect
                key={v.name}
                size="sm"
                className="w-40"
                aria-label={v.label ?? v.name}
                value={vars[v.name] ?? ''}
                onValueChange={(value) => setVars((prev) => ({ ...prev, [v.name]: value }))}
                options={(v.options ?? []).map((o) => ({ label: o, value: o }))}
                placeholder={v.label ?? v.name}
              />
            ))}
            <TimeRangePicker value={range} onValueChange={setRange} size="sm" />
            <RefreshPicker onRefresh={() => void data.refetch()} refreshing={data.isFetching} />
            {isBuiltin ? null : editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={stopEditing}>
                  <X /> Cancel
                </Button>
                <Button
                  size="sm"
                  loading={update.isPending}
                  onClick={() =>
                    update.mutate(
                      {
                        id: dashboardId,
                        title: spec.data?.title ?? dashboardId,
                        description: spec.data?.description ?? '',
                        tags: spec.data?.tags ?? [],
                        variables: spec.data?.variables ?? [],
                        rows: draftRows ?? [],
                      },
                      {
                        onSuccess: () => {
                          toast.success('Dashboard saved');
                          stopEditing();
                        },
                        onError: (e) => toastError('Save failed', e),
                      },
                    )
                  }
                >
                  <Save /> Save
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />

      {spec.isLoading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 lg:col-span-4" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutDashboard}
            title="This dashboard is empty"
            description="Add a panel with a PromQL query to start visualising metrics."
            action={
              isBuiltin ? undefined : (
                <Button
                  onClick={() => {
                    if (!editing) startEditing();
                    setEditorTarget({ rowIndex: 0, panel: null });
                  }}
                >
                  <Plus /> Add panel
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {rows.map((row, rowIndex) => {
            const key = row.title || `row-${rowIndex}`;
            const isCollapsed = collapsed[key] ?? false;
            return (
              <section key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                    onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    {row.title || `Row ${rowIndex + 1}`}
                    <span className="text-[var(--muted)]">({row.panels.length})</span>
                  </button>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  {editing ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditorTarget({ rowIndex, panel: null })}
                    >
                      <Plus /> Add panel
                    </Button>
                  ) : null}
                </div>

                {isCollapsed ? null : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
                    {row.panels.map((panel, panelIndex) => {
                      const geo = panelGeometry(panel);
                      return (
                        <Panel
                          key={panel.id}
                          panel={panel}
                          data={data.data?.panels?.[panel.id]}
                          loading={data.isLoading}
                          error={data.error}
                          onRetry={() => void data.refetch()}
                          editable={editing}
                          className={SPAN_CLASS[geo.w]}
                          onFullscreen={() => setFullscreen(panel)}
                          onExplore={() =>
                            void navigate(
                              `/c/${cluster}/metrics/explore?q=${encodeURIComponent(
                                panel.queries?.[0]?.expr ?? '',
                              )}&range=${range}`,
                            )
                          }
                          onEdit={editing ? () => setEditorTarget({ rowIndex, panel }) : undefined}
                          onDelete={editing ? () => removePanel(rowIndex, panelIndex) : undefined}
                          onMove={
                            editing ? (dir) => movePanel(rowIndex, panelIndex, dir) : undefined
                          }
                        />
                      );
                    })}
                    {row.panels.length === 0 ? (
                      <Card className="lg:col-span-12">
                        <EmptyState compact title="No panels in this row" />
                      </Card>
                    ) : null}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <PanelEditor
        open={editorTarget !== null}
        onOpenChange={(open) => !open && setEditorTarget(null)}
        panel={editorTarget?.panel ?? null}
        suggestions={metricNames}
        onSave={(panel) => {
          if (!editorTarget) return;
          savePanel(editorTarget.rowIndex, {
            ...panel,
            id: panel.id || newPanelId(allPanelIds),
          });
          setEditorTarget(null);
        }}
      />

      <Dialog open={fullscreen !== null} onOpenChange={(open) => !open && setFullscreen(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{fullscreen?.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {fullscreen ? (
              <Panel
                panel={fullscreen}
                data={data.data?.panels?.[fullscreen.id]}
                loading={data.isLoading}
                error={data.error}
                heightOverride={460}
                className="border-0 shadow-none"
              />
            ) : null}
            {fullscreen?.queries?.map((q, i) => (
              <pre
                key={i}
                className="mt-2 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-2xs"
              >
                {q.expr}
              </pre>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MetricsDashboardPage;
