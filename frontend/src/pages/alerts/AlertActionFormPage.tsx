import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Send, Trash2 } from 'lucide-react';
import {
  useAlertAction,
  useCreateAlertAction,
  useDeleteAlertAction,
  useTestAlertAction,
  useUpdateAlertAction,
} from '@/api/hooks/alerts';
import type { AlertActionType } from '@/api/types';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast, toastError } from '@/components/ui/toast';
import { ACTION_TYPES, actionTypeIcon, isAlertsUnavailable } from './alertsLib';

const TEMPLATE_VARIABLES = [
  '{{severity}}',
  '{{triggerName}}',
  '{{component}}',
  '{{target}}',
  '{{clusterId}}',
  '{{metric}}',
  '{{value}}',
  '{{threshold}}',
  '{{status}}',
  '{{firedAt}}',
];

const DEFAULT_TEMPLATE =
  '[{{severity}}] {{triggerName}} — {{component}} {{target}} {{metric}}={{value}} (threshold {{threshold}}) on {{clusterId}}';

interface FormState {
  name: string;
  type: AlertActionType;
  enabled: boolean;
  recipients: string;
  subject: string;
  url: string;
  channel: string;
  routingKey: string;
  method: string;
  headers: string;
  template: string;
}

const INITIAL: FormState = {
  name: '',
  type: 'slack',
  enabled: true,
  recipients: '',
  subject: 'k-shui alert: {{triggerName}}',
  url: '',
  channel: '',
  routingKey: '',
  method: 'POST',
  headers: '',
  template: DEFAULT_TEMPLATE,
};

function str(config: Record<string, unknown>, key: string, fallback = ''): string {
  const v = config[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function AlertActionFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('id') ?? undefined;

  const existing = useAlertAction(id);
  const create = useCreateAlertAction();
  const update = useUpdateAlertAction();
  const remove = useDeleteAlertAction();
  const test = useTestAlertAction();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const a = existing.data;
    if (!a || loadedId === a.id) return;
    setLoadedId(a.id);
    const c = a.config ?? {};
    setForm({
      name: a.name,
      type: a.type,
      enabled: a.enabled,
      recipients: str(c, 'recipients') || str(c, 'to'),
      subject: str(c, 'subject', INITIAL.subject),
      url: str(c, 'url') || str(c, 'webhookUrl'),
      channel: str(c, 'channel'),
      routingKey: str(c, 'routingKey'),
      method: str(c, 'method', 'POST'),
      headers: str(c, 'headers'),
      template: str(c, 'template', DEFAULT_TEMPLATE),
    });
  }, [existing.data, loadedId]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const config = useMemo((): Record<string, unknown> => {
    switch (form.type) {
      case 'email':
        return {
          recipients: form.recipients
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          subject: form.subject,
          template: form.template,
        };
      case 'slack':
        return { url: form.url, channel: form.channel || undefined, template: form.template };
      case 'teams':
        return { url: form.url, template: form.template };
      case 'pagerduty':
        return { routingKey: form.routingKey, template: form.template };
      case 'webhook':
      default:
        return {
          url: form.url,
          method: form.method,
          headers: form.headers,
          template: form.template,
        };
    }
  }, [form]);

  const valid =
    form.name.trim().length > 0 &&
    (form.type === 'email'
      ? form.recipients.trim().length > 0
      : form.type === 'pagerduty'
        ? form.routingKey.trim().length > 0
        : form.url.trim().length > 0);

  const submit = () => {
    const body = { name: form.name.trim(), type: form.type, config, enabled: form.enabled };
    if (id) {
      update.mutate(
        { id, ...body },
        {
          onSuccess: () => {
            toast.success('Action saved');
            void navigate('/alerts?tab=actions');
          },
          onError: (e) => toastError('Save failed', e),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast.success('Action created');
          void navigate('/alerts?tab=actions');
        },
        onError: (e) => toastError('Create failed', e),
      });
    }
  };

  if (id && existing.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (id && existing.error && !isAlertsUnavailable(existing.error)) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  const Icon = actionTypeIcon(form.type);
  const typeHint = ACTION_TYPES.find((a) => a.value === form.type)?.hint;

  return (
    <div className="space-y-5">
      <PageHeader
        title={id ? form.name || 'Edit action' : 'New notification action'}
        description="Where alerts are delivered when a trigger fires or resolves."
        meta={<Icon className="size-4 text-[var(--primary)]" />}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/alerts?tab=actions">
                <ArrowLeft /> Actions
              </Link>
            </Button>
            {id ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  loading={test.isPending}
                  onClick={() =>
                    test.mutate(id, {
                      onSuccess: (result) => {
                        const ok = result?.ok !== false && result?.status !== 'error';
                        if (ok)
                          toast.success('Test notification sent', {
                            description: result?.message,
                          });
                        else
                          toast.error('Test failed', {
                            description: result?.error ?? result?.message,
                          });
                      },
                      onError: (e) => toastError('Test failed', e),
                    })
                  }
                >
                  <Send /> Send test
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              disabled={!valid}
              loading={create.isPending || update.isPending}
              onClick={submit}
            >
              <Save /> {id ? 'Save action' : 'Create action'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardToolbarHeader title="Action" description={typeHint} />
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="action-name">Name</Label>
              <Input
                id="action-name"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Platform on-call"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <SimpleSelect
                value={form.type}
                onValueChange={(v) => patch({ type: v as AlertActionType })}
                options={ACTION_TYPES.map((a) => ({ label: a.label, value: a.value }))}
                aria-label="Action type"
              />
            </div>

            {form.type === 'email' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="action-recipients">Recipients</Label>
                  <Input
                    id="action-recipients"
                    value={form.recipients}
                    onChange={(e) => patch({ recipients: e.target.value })}
                    placeholder="oncall@example.com, sre@example.com"
                    className="font-mono"
                  />
                  <p className="text-2xs text-[var(--muted)]">Comma separated.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="action-subject">Subject</Label>
                  <Input
                    id="action-subject"
                    value={form.subject}
                    onChange={(e) => patch({ subject: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </>
            ) : null}

            {form.type === 'slack' || form.type === 'teams' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="action-url">Incoming webhook URL</Label>
                  <Input
                    id="action-url"
                    value={form.url}
                    onChange={(e) => patch({ url: e.target.value })}
                    placeholder="https://hooks.slack.com/services/…"
                    className="font-mono"
                  />
                </div>
                {form.type === 'slack' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="action-channel">Channel override</Label>
                    <Input
                      id="action-channel"
                      value={form.channel}
                      onChange={(e) => patch({ channel: e.target.value })}
                      placeholder="#kafka-alerts"
                      className="font-mono"
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {form.type === 'pagerduty' ? (
              <div className="space-y-1.5">
                <Label htmlFor="action-routing">Events API v2 routing key</Label>
                <Input
                  id="action-routing"
                  type="password"
                  value={form.routingKey}
                  onChange={(e) => patch({ routingKey: e.target.value })}
                  placeholder="R0ABCD…"
                  className="font-mono"
                />
              </div>
            ) : null}

            {form.type === 'webhook' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="action-url">Endpoint URL</Label>
                  <Input
                    id="action-url"
                    value={form.url}
                    onChange={(e) => patch({ url: e.target.value })}
                    placeholder="https://example.com/hooks/kshui"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Method</Label>
                    <SimpleSelect
                      value={form.method}
                      onValueChange={(v) => patch({ method: v })}
                      options={[
                        { label: 'POST', value: 'POST' },
                        { label: 'PUT', value: 'PUT' },
                      ]}
                      aria-label="HTTP method"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="action-headers">Extra headers</Label>
                    <Input
                      id="action-headers"
                      value={form.headers}
                      onChange={(e) => patch({ headers: e.target.value })}
                      placeholder="X-Token: abc"
                      className="font-mono"
                    />
                  </div>
                </div>
              </>
            ) : null}

            <label className="flex items-center gap-2.5">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => patch({ enabled: v })}
                aria-label="Enabled"
              />
              <span className="text-xs text-[var(--foreground)]">
                Enabled — deliver notifications through this action
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardToolbarHeader
            title="Message template"
            description="Rendered for every fired and resolved alert."
          />
          <CardContent className="space-y-3">
            <Textarea
              rows={8}
              value={form.template}
              onChange={(e) => patch({ template: e.target.value })}
              className="font-mono text-xs"
              aria-label="Message template"
            />
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Available variables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => patch({ template: `${form.template}${v}` })}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-2xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDestructiveDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete action"
        description={
          <>
            Permanently removes <span className="font-mono">{form.name}</span>. Triggers using it
            will stop notifying.
          </>
        }
        confirmLabel="Delete action"
        loading={remove.isPending}
        onConfirm={() => {
          if (!id) return;
          remove.mutate(id, {
            onSuccess: () => {
              toast.success('Action deleted');
              void navigate('/alerts?tab=actions');
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </div>
  );
}

export const NewAlertActionPage = AlertActionFormPage;

export default AlertActionFormPage;
