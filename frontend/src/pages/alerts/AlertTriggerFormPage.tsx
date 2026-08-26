import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import {
  useAlertActions,
  useAlertMetricCatalog,
  useAlertTrigger,
  useCreateAlertTrigger,
  useDeleteAlertTrigger,
  useUpdateAlertTrigger,
} from '@/api/hooks/alerts';
import { useClusters } from '@/api/hooks/clusters';
import type { AlertComponent, AlertCondition, AlertMetricDef, AlertSeverity } from '@/api/types';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiCombobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast, toastError } from '@/components/ui/toast';
import { TargetPicker } from './components/TargetPicker';
import {
  COMPONENTS,
  CONDITIONS,
  FALLBACK_METRICS,
  SEVERITIES,
  componentLabel,
  conditionSymbol,
  isAlertsUnavailable,
  severityTone,
} from './alertsLib';

interface FormState {
  name: string;
  clusterId: string;
  component: AlertComponent;
  targetName: string;
  targetRegex: string;
  usePattern: boolean;
  metric: string;
  promql: string;
  condition: AlertCondition;
  value: string;
  bufferSeconds: string;
  severity: AlertSeverity;
  actionIds: string[];
  enabled: boolean;
}

const INITIAL: FormState = {
  name: '',
  clusterId: '',
  component: 'consumerGroup',
  targetName: '',
  targetRegex: '',
  usePattern: false,
  metric: 'lag',
  promql: '',
  condition: 'gt',
  value: '1000',
  bufferSeconds: '60',
  severity: 'warning',
  actionIds: [],
  enabled: true,
};

const ALL_CLUSTERS = '__all__';

function TriggerForm({ id }: { id?: string }) {
  const navigate = useNavigate();
  const clusters = useClusters();
  const actions = useAlertActions();
  const catalog = useAlertMetricCatalog();
  const existing = useAlertTrigger(id);
  const create = useCreateAlertTrigger();
  const update = useUpdateAlertTrigger();
  const remove = useDeleteAlertTrigger();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const t = existing.data;
    if (!t || loadedId === t.id) return;
    setLoadedId(t.id);
    setForm({
      name: t.name,
      clusterId: t.clusterId ?? '',
      component: t.component,
      targetName: t.target?.name ?? '',
      targetRegex: t.target?.regex ?? '',
      usePattern: Boolean(t.target?.regex),
      metric: t.component === 'custom' ? 'promql' : t.metric,
      promql: t.component === 'custom' ? t.metric : '',
      condition: t.condition,
      value: String(t.value),
      bufferSeconds: String(t.bufferSeconds),
      severity: t.severity,
      actionIds: t.actionIds ?? [],
      enabled: t.enabled,
    });
  }, [existing.data, loadedId]);

  const metrics: AlertMetricDef[] = useMemo(() => {
    const source = catalog.data ?? FALLBACK_METRICS;
    return source[form.component] ?? FALLBACK_METRICS[form.component] ?? [];
  }, [catalog.data, form.component]);

  const selectedMetric = metrics.find((m) => m.name === form.metric);

  useEffect(() => {
    if (metrics.length === 0) return;
    if (metrics.some((m) => m.name === form.metric)) return;
    setForm((f) => ({ ...f, metric: metrics[0].name }));
  }, [metrics, form.metric]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const isCustom = form.component === 'custom';
  const valid =
    form.name.trim().length > 0 &&
    (isCustom ? form.promql.trim().length > 0 : form.metric.length > 0) &&
    form.value.trim().length > 0;

  const body = {
    name: form.name.trim(),
    clusterId: form.clusterId === '' || form.clusterId === ALL_CLUSTERS ? null : form.clusterId,
    component: form.component,
    target: form.usePattern
      ? form.targetRegex
        ? { regex: form.targetRegex }
        : {}
      : form.targetName
        ? { name: form.targetName }
        : {},
    metric: isCustom ? form.promql.trim() : form.metric,
    condition: form.condition,
    value: Number(form.value),
    bufferSeconds: Number(form.bufferSeconds) || 0,
    severity: form.severity,
    enabled: form.enabled,
    actionIds: form.actionIds,
  };

  const submit = () => {
    if (id) {
      update.mutate(
        { id, ...body },
        {
          onSuccess: () => {
            toast.success('Trigger saved');
            void navigate('/alerts?tab=triggers');
          },
          onError: (e) => toastError('Save failed', e),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast.success('Trigger created');
          void navigate('/alerts?tab=triggers');
        },
        onError: (e) => toastError('Create failed', e),
      });
    }
  };

  if (id && existing.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (id && existing.error && !isAlertsUnavailable(existing.error)) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const targetLabel = form.usePattern ? form.targetRegex || 'any' : form.targetName || 'any';

  return (
    <div className="space-y-5">
      <PageHeader
        title={id ? form.name || 'Edit trigger' : 'New trigger'}
        description="Fire a notification when a component crosses a threshold for long enough."
        meta={id ? <StatusPill status={form.severity} tone={severityTone(form.severity)} /> : null}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/alerts?tab=triggers">
                <ArrowLeft /> Triggers
              </Link>
            </Button>
            {id ? (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={!valid}
              loading={create.isPending || update.isPending}
              onClick={submit}
            >
              <Save /> {id ? 'Save trigger' : 'Create trigger'}
            </Button>
          </>
        }
      />

      {/* live preview */}
      <Card className="border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_5%,var(--surface))] p-4">
        <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Preview
        </p>
        <p className="mt-1.5 text-sm leading-6 text-[var(--foreground)]">
          Fire <StatusPill status={form.severity} tone={severityTone(form.severity)} /> when{' '}
          {componentLabel(form.component).toLowerCase()}{' '}
          <span className="rounded bg-[var(--surface-2)] px-1 font-mono text-xs">
            {targetLabel}
          </span>{' '}
          {isCustom ? (
            <span className="rounded bg-[var(--surface-2)] px-1 font-mono text-xs">
              {form.promql || 'promql'}
            </span>
          ) : (
            <span className="font-medium">{form.metric}</span>
          )}{' '}
          <span className="font-mono">{conditionSymbol(form.condition)}</span>{' '}
          <span className="font-mono tabular-nums">{form.value || '0'}</span>
          {selectedMetric?.unit ? (
            <span className="text-[var(--muted)]"> {selectedMetric.unit}</span>
          ) : null}{' '}
          {Number(form.bufferSeconds) > 0 ? (
            <>
              for <span className="font-mono tabular-nums">{form.bufferSeconds}s</span>
            </>
          ) : (
            'immediately'
          )}{' '}
          on <span className="font-mono">{body.clusterId ?? 'all clusters'}</span>.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardToolbarHeader title="What to watch" />
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="trigger-name">Name</Label>
              <Input
                id="trigger-name"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Orders consumer lag"
                autoFocus
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Cluster</Label>
                <SimpleSelect
                  value={form.clusterId || ALL_CLUSTERS}
                  onValueChange={(v) => patch({ clusterId: v === ALL_CLUSTERS ? '' : v })}
                  options={[
                    { label: 'All clusters', value: ALL_CLUSTERS },
                    ...(clusters.data ?? []).map((c) => ({ label: c.name, value: c.id })),
                  ]}
                  aria-label="Cluster"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Component</Label>
                <SimpleSelect
                  value={form.component}
                  onValueChange={(v) =>
                    patch({ component: v as AlertComponent, targetName: '', targetRegex: '' })
                  }
                  options={COMPONENTS.map((c) => ({ label: c.label, value: c.value }))}
                  aria-label="Component"
                />
              </div>
            </div>

            <TargetPicker
              cluster={form.clusterId || null}
              component={form.component}
              name={form.targetName}
              regex={form.targetRegex}
              usePattern={form.usePattern}
              onUsePatternChange={(v) => patch({ usePattern: v })}
              onNameChange={(v) => patch({ targetName: v })}
              onRegexChange={(v) => patch({ targetRegex: v })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader title="Condition" />
          <CardContent className="space-y-4">
            {isCustom ? (
              <div className="space-y-1.5">
                <Label htmlFor="trigger-promql">PromQL expression</Label>
                <Textarea
                  id="trigger-promql"
                  rows={3}
                  value={form.promql}
                  onChange={(e) => patch({ promql: e.target.value })}
                  placeholder="sum(rate(kafka_server_brokertopicmetrics_bytesin_total[5m]))"
                  className="font-mono text-xs"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Metric</Label>
                <SimpleSelect
                  value={form.metric}
                  onValueChange={(v) => patch({ metric: v })}
                  options={metrics.map((m) => ({ label: m.name, value: m.name }))}
                  placeholder="Select a metric"
                  aria-label="Metric"
                />
                {selectedMetric ? (
                  <p className="text-2xs text-[var(--muted)]">
                    {selectedMetric.description}
                    {selectedMetric.unit ? (
                      <span className="font-mono"> ({selectedMetric.unit})</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Operator</Label>
                <SimpleSelect
                  value={form.condition}
                  onValueChange={(v) => patch({ condition: v as AlertCondition })}
                  options={CONDITIONS.map((c) => ({
                    label: `${c.symbol}  ${c.label}`,
                    value: c.value,
                  }))}
                  aria-label="Operator"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trigger-value">
                  Threshold
                  {selectedMetric?.unit ? (
                    <span className="ml-1 font-normal text-[var(--muted)]">
                      ({selectedMetric.unit})
                    </span>
                  ) : null}
                </Label>
                <Input
                  id="trigger-value"
                  type="number"
                  value={form.value}
                  onChange={(e) => patch({ value: e.target.value })}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="trigger-buffer">Buffer (seconds)</Label>
                <Input
                  id="trigger-buffer"
                  type="number"
                  min={0}
                  value={form.bufferSeconds}
                  onChange={(e) => patch({ bufferSeconds: e.target.value })}
                  className="font-mono"
                />
                <p className="text-2xs text-[var(--muted)]">
                  The condition must hold for this long before the alert fires.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <SimpleSelect
                  value={form.severity}
                  onValueChange={(v) => patch({ severity: v as AlertSeverity })}
                  options={SEVERITIES}
                  aria-label="Severity"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardToolbarHeader
            title="Notifications"
            description="Actions run every time this trigger fires or resolves."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/alerts/actions/new">New action</Link>
              </Button>
            }
          />
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Actions</Label>
              <MultiCombobox
                className="w-full max-w-md"
                options={(actions.data ?? []).map((a) => ({
                  label: a.name,
                  value: a.id,
                  description: a.type,
                }))}
                values={form.actionIds}
                onValuesChange={(v) => patch({ actionIds: v })}
                placeholder="Select notification actions…"
                searchPlaceholder="Search actions…"
                emptyText={actions.isLoading ? 'Loading…' : 'No actions configured yet'}
                summary={(v) => `${v.length} action${v.length === 1 ? '' : 's'}`}
              />
              {form.actionIds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.actionIds.map((aid) => (
                    <Badge key={aid} variant="secondary" size="sm">
                      {(actions.data ?? []).find((a) => a.id === aid)?.name ?? aid}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <label className="flex items-center gap-2.5">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => patch({ enabled: v })}
                aria-label="Enabled"
              />
              <span className="text-xs text-[var(--foreground)]">
                Enabled — evaluate this trigger on every interval
              </span>
            </label>
          </CardContent>
        </Card>
      </div>

      <ConfirmDestructiveDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete trigger"
        description={
          <>
            Permanently removes <span className="font-mono">{form.name}</span> and stops all
            evaluation.
          </>
        }
        confirmLabel="Delete trigger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!id) return;
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('Trigger deleted');
              void navigate('/alerts?tab=triggers');
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </div>
  );
}

export function NewAlertTriggerPage() {
  return <TriggerForm />;
}

export function AlertTriggerDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <TriggerForm id={id} />;
}

export default NewAlertTriggerPage;
