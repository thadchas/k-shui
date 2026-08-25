import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  Plus,
  RefreshCw,
  TableProperties,
} from 'lucide-react';
import { useConnectPlugins, useCreateConnector, useValidatePlugin } from '@/api/hooks/connect';
import type { ConnectorPlugin } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { CodeEditor } from '@/components/CodeEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { ConnectorConfigForm } from './components/ConnectorConfigForm';
import { PluginGrid } from './components/PluginGrid';
import { UnsavedChangesGuard } from './components/UnsavedChangesGuard';
import { shortClass } from './components/connectUtils';

type Step = 'plugin' | 'config';

export function NewConnectorPage() {
  const cluster = useClusterId();
  const { kc: kcParam = '' } = useParams<{ kc: string }>();
  const kc = decodeURIComponent(kcParam);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const base = `/c/${cluster}/connect/${encodeURIComponent(kc)}`;

  const presetPlugin = searchParams.get('plugin') ?? '';

  const [step, setStep] = useState<Step>(presetPlugin ? 'config' : 'plugin');
  const [pluginClass, setPluginClass] = useState(presetPlugin);
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>(
    presetPlugin ? { 'connector.class': presetPlugin } : {},
  );
  const [view, setView] = useState<'form' | 'json'>('form');
  const [rawJson, setRawJson] = useState('{}');
  const [rawError, setRawError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const { canEdit } = usePermissions();

  const plugins = useConnectPlugins(cluster, kc);
  const validate = useValidatePlugin(cluster, kc);
  const create = useCreateConnector(cluster, kc);

  const fullConfig = useMemo(
    () => ({
      ...config,
      ...(name ? { name } : {}),
      ...(pluginClass ? { 'connector.class': pluginClass } : {}),
    }),
    [config, name, pluginClass],
  );

  const configKey = useMemo(() => JSON.stringify(fullConfig), [fullConfig]);
  const dirty =
    !created &&
    (name.trim() !== '' ||
      Object.keys(config).some((k) => k !== 'connector.class' && k !== 'name'));
  const debouncedKey = useDebounced(configKey, 500);

  const runValidation = useCallback(
    (payload: Record<string, string>) => {
      if (!pluginClass) return;
      validate.mutate({ pluginClass, config: payload });
    },
    // `validate` is a stable mutation object from react-query
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginClass],
  );

  /* Live re-validate as the user edits (debounced). */
  useEffect(() => {
    if (step !== 'config' || !pluginClass) return;
    runValidation(JSON.parse(debouncedKey) as Record<string, string>);
  }, [debouncedKey, pluginClass, step, runValidation]);

  /* Keep the raw JSON tab in sync with the form. */
  useEffect(() => {
    if (view === 'form') setRawJson(JSON.stringify(fullConfig, null, 2));
  }, [fullConfig, view]);

  const validation = validate.data;
  const errorCount = validation?.errorCount ?? 0;

  const selectPlugin = (plugin: ConnectorPlugin) => {
    setPluginClass(plugin.class);
    setConfig((prev) => ({ ...prev, 'connector.class': plugin.class }));
    setStep('config');
  };

  const onFieldChange = (field: string, value: string) => {
    if (field === 'name') {
      setName(value);
      return;
    }
    setConfig((prev) => {
      const next = { ...prev };
      if (value === '') delete next[field];
      else next[field] = value;
      return next;
    });
  };

  const applyRawJson = (text: string) => {
    setRawJson(text);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        flat[key] = value === null || value === undefined ? '' : String(value);
      }
      setRawError(null);
      if (flat.name !== undefined) setName(flat.name);
      if (flat['connector.class']) setPluginClass(flat['connector.class']);
      setConfig(flat);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const onCreate = async () => {
    try {
      await create.mutateAsync({ name: name.trim(), config: fullConfig });
      toast.success(`Connector ${name.trim()} created`);
      flushSync(() => setCreated(true));
      void navigate(`${base}/connectors/${encodeURIComponent(name.trim())}`);
    } catch (e) {
      toastError('Failed to create connector', e);
    }
  };

  const selectedPlugin = plugins.data?.find((p) => p.class === pluginClass);

  return (
    <div>
      <UnsavedChangesGuard dirty={dirty} />
      <PageHeader
        title="New connector"
        description={`Create a connector on ${kc}.`}
        meta={
          <span className="flex items-center gap-1.5">
            <Badge variant={step === 'plugin' ? 'default' : 'secondary'}>1 · Plugin</Badge>
            <Badge variant={step === 'config' ? 'default' : 'secondary'}>2 · Configure</Badge>
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={base}>
                <ArrowLeft /> Connectors
              </Link>
            </Button>
            {step === 'config' ? (
              <>
                <Button variant="outline" onClick={() => setStep('plugin')}>
                  Change plugin
                </Button>
                <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
                  <span className="inline-flex">
                    <Button
                      loading={create.isPending}
                      disabled={!canEdit || !name.trim() || !pluginClass || Boolean(rawError)}
                      onClick={() => void onCreate()}
                    >
                      <Plus /> Create connector
                    </Button>
                  </span>
                </Tooltip>
              </>
            ) : null}
          </>
        }
      />

      {step === 'plugin' ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Choose a plugin</CardTitle>
            {pluginClass ? (
              <Button size="sm" onClick={() => setStep('config')}>
                Continue <ArrowRight />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <PluginGrid
              plugins={plugins.data}
              loading={plugins.isLoading}
              error={plugins.error}
              onRetry={() => void plugins.refetch()}
              selected={pluginClass}
              onSelect={selectPlugin}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="connector-name">
                  Connector name<span className="ml-0.5 text-[var(--danger)]">*</span>
                </Label>
                <Input
                  id="connector-name"
                  mono
                  autoComplete="off"
                  placeholder="orders-source-seed"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="text-2xs text-[var(--muted)]">
                  Must be unique across the Connect cluster.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Plugin</Label>
                <div className="flex h-8 items-center gap-2">
                  <Badge variant={selectedPlugin?.type === 'source' ? 'accent' : 'info'}>
                    {selectedPlugin?.type ?? 'connector'}
                  </Badge>
                  <span className="truncate font-mono text-xs">{shortClass(pluginClass)}</span>
                  {selectedPlugin?.version ? (
                    <span className="font-mono text-2xs text-[var(--muted)]">
                      v{selectedPlugin.version}
                    </span>
                  ) : null}
                </div>
                <p className="truncate font-mono text-2xs text-[var(--muted)]">{pluginClass}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle>Configuration</CardTitle>
                {validate.isPending ? (
                  <span className="flex items-center gap-1 text-2xs text-[var(--muted)]">
                    <RefreshCw className="size-3 animate-spin" /> validating
                  </span>
                ) : errorCount > 0 ? (
                  <Badge variant="danger">
                    {errorCount} error{errorCount === 1 ? '' : 's'}
                  </Badge>
                ) : validation ? (
                  <Badge variant="success">
                    <Check className="size-3" /> valid
                  </Badge>
                ) : null}
              </div>
              <Tabs value={view} onValueChange={(v) => setView(v as 'form' | 'json')}>
                <SegmentedList>
                  <SegmentedTrigger value="form">
                    <TableProperties className="size-3.5" /> Form
                  </SegmentedTrigger>
                  <SegmentedTrigger value="json">
                    <Braces className="size-3.5" /> JSON
                  </SegmentedTrigger>
                </SegmentedList>
              </Tabs>
            </CardHeader>
            <CardContent className="space-y-3">
              {validate.error ? (
                <InlineError error={validate.error} onRetry={() => runValidation(fullConfig)} />
              ) : null}

              {view === 'form' ? (
                <ConnectorConfigForm
                  validation={validation}
                  loading={validate.isPending}
                  config={fullConfig}
                  onChange={onFieldChange}
                />
              ) : (
                <div className="space-y-2">
                  <CodeEditor
                    value={rawJson}
                    onChange={applyRawJson}
                    language="json"
                    minimal={false}
                    height={480}
                    ariaLabel="Connector configuration JSON"
                  />
                  {rawError ? (
                    <p className="font-mono text-2xs text-[var(--danger)]">{rawError}</p>
                  ) : (
                    <p className="text-2xs text-[var(--muted)]">
                      Edits here stay in sync with the form and are validated against the plugin.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default NewConnectorPage;
