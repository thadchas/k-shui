/**
 * Guided "Test a connection" flow for cluster onboarding.
 *
 * k-shui's cluster list is deployment-managed, so this never adds a cluster: it validates
 * candidate details component by component, says whether a failure is connectivity,
 * credentials or permissions, and hands back the YAML fragment to apply and restart with.
 */
import { useState } from 'react';
import { useForm, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Download, Play, TriangleAlert } from 'lucide-react';
import { useConnectionConfig, useConnectionTest } from '@/api/hooks/system';
import type {
  ConnectionComponentResult,
  ConnectionTestResponse,
  GeneratedClusterConfig,
} from '@/api/types';
import { usePermissions } from '@/hooks/usePermissions';
import { downloadText } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormRow,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { KeyValueEditor, type KeyValuePair } from '@/components/ui/key-value-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import {
  CATEGORY_META,
  DEFAULT_FORM_VALUES,
  STATUS_LABELS,
  configFilename,
  connectionSchema,
  envExportSnippet,
  summarizeMetadata,
  toConnectionRequest,
  usesSasl,
  type ConnectionFormValues,
} from './connectionTester';

const REQUIRES_ADMIN = 'Requires admin role';

const PROPERTY_SUGGESTIONS = [
  'ssl.ca.location',
  'ssl.certificate.location',
  'ssl.key.location',
  'ssl.key.password',
  'ssl.endpoint.identification.algorithm',
  'sasl.kerberos.service.name',
  'client.id',
];

type FieldName = keyof ConnectionFormValues;

function TextField({
  name,
  label,
  placeholder,
  description,
  password,
  required,
}: {
  name: FieldName;
  label: string;
  placeholder?: string;
  description?: React.ReactNode;
  password?: boolean;
  required?: boolean;
}) {
  const form = useFormContext<ConnectionFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={required}>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              mono={!password}
              type={password ? 'password' : 'text'}
              placeholder={placeholder}
              autoComplete={password ? 'new-password' : 'off'}
              spellCheck={false}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SelectField({
  name,
  label,
  options,
  description,
}: {
  name: FieldName;
  label: string;
  options: { value: string; label: string }[];
  description?: React.ReactNode;
}) {
  const form = useFormContext<ConnectionFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-2xs text-[var(--muted)]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ResultRow({ result }: { result: ConnectionComponentResult }) {
  const ok = result.status === 'ok';
  const meta = CATEGORY_META[result.category];
  const facts = summarizeMetadata(result);
  return (
    <li className="flex gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{result.label}</span>
          <Badge variant={meta.badge} size="sm">
            {ok ? STATUS_LABELS[result.status] : `${meta.label} · ${STATUS_LABELS[result.status]}`}
          </Badge>
          {result.latencyMs !== null ? (
            <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
              {Math.round(result.latencyMs)} ms
            </span>
          ) : null}
        </div>
        <p className="truncate font-mono text-2xs text-[var(--muted)]">{result.target}</p>
        <p className="text-xs leading-5">{result.detail}</p>
        {ok && facts ? <p className="font-mono text-2xs text-[var(--muted)]">{facts}</p> : null}
        {!ok ? <p className="text-2xs text-[var(--muted)]">{meta.hint}</p> : null}
      </div>
    </li>
  );
}

export function ConnectionTesterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isAdmin, loading } = usePermissions();
  const test = useConnectionTest();
  const config = useConnectionConfig();
  const [properties, setProperties] = useState<KeyValuePair[]>([]);
  const [result, setResult] = useState<ConnectionTestResponse | null>(null);
  const [generated, setGenerated] = useState<GeneratedClusterConfig | null>(null);

  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionSchema),
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const protocol = form.watch('securityProtocol');
  const clusterId = form.watch('clusterId');
  const schemaRegistryUrl = form.watch('schemaRegistryUrl');
  const connectUrl = form.watch('connectUrl');
  const ksqlUrl = form.watch('ksqlUrl');
  const prometheusUrl = form.watch('prometheusUrl');
  const disabled = !isAdmin && !loading;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const response = await test.mutateAsync(toConnectionRequest(values, properties));
      setResult(response);
      setGenerated(response.config);
    } catch (e) {
      toastError('Could not run the connection test', e);
    }
  });

  const onGenerate = async () => {
    const parsed = connectionSchema.safeParse(form.getValues());
    if (!parsed.success) {
      void form.trigger();
      return;
    }
    try {
      setGenerated(await config.mutateAsync(toConnectionRequest(parsed.data, properties)));
    } catch (e) {
      toastError('Could not generate the config', e);
    }
  };

  const envSnippet = generated ? envExportSnippet(generated.envVars) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Test a connection</DialogTitle>
          <DialogDescription>
            Check candidate connection details before editing <code>k-shui.yaml</code>. Every
            component you fill in is tested on its own, and failures say whether the problem is
            connectivity, credentials or permissions. Nothing is saved — k-shui reads its cluster
            list at startup, so you apply the generated YAML and restart.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <Form {...form}>
            <form id="connection-test-form" onSubmit={onSubmit} className="space-y-6">
              <Section title="Cluster">
                <FormRow>
                  <TextField
                    name="clusterId"
                    label="Cluster id"
                    placeholder="local"
                    required
                    description="Used in URLs and config; must be unique."
                  />
                  <TextField name="clusterName" label="Display name" placeholder="Production EU" />
                </FormRow>
                <TextField
                  name="bootstrapServers"
                  label="Bootstrap servers"
                  placeholder="broker-1:9092,broker-2:9092"
                  required
                  description="Comma-separated host:port list."
                />
              </Section>

              <Separator />

              <Section
                title="Security"
                description="Credentials are used for this test and returned only as ${ENV_VAR} placeholders."
              >
                <FormRow>
                  <SelectField
                    name="securityProtocol"
                    label="Security protocol"
                    options={[
                      { value: 'PLAINTEXT', label: 'PLAINTEXT' },
                      { value: 'SSL', label: 'SSL' },
                      { value: 'SASL_PLAINTEXT', label: 'SASL_PLAINTEXT' },
                      { value: 'SASL_SSL', label: 'SASL_SSL' },
                    ]}
                  />
                  {usesSasl(protocol) ? (
                    <SelectField
                      name="saslMechanism"
                      label="SASL mechanism"
                      options={[
                        { value: 'PLAIN', label: 'PLAIN' },
                        { value: 'SCRAM-SHA-256', label: 'SCRAM-SHA-256' },
                        { value: 'SCRAM-SHA-512', label: 'SCRAM-SHA-512' },
                        { value: 'GSSAPI', label: 'GSSAPI' },
                        { value: 'OAUTHBEARER', label: 'OAUTHBEARER' },
                      ]}
                    />
                  ) : null}
                </FormRow>
                {usesSasl(protocol) ? (
                  <FormRow>
                    <TextField name="saslUsername" label="SASL username" placeholder="k-shui" />
                    <TextField name="saslPassword" label="SASL password" password />
                  </FormRow>
                ) : null}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">Extra client properties</p>
                  <KeyValueEditor
                    value={properties}
                    onChange={setProperties}
                    keyPlaceholder="ssl.ca.location"
                    valuePlaceholder="value"
                    addLabel="Add property"
                    keySuggestions={PROPERTY_SUGGESTIONS}
                  />
                  <p className="text-2xs text-[var(--muted)]">
                    Raw librdkafka properties, passed through to the client.
                  </p>
                </div>
              </Section>

              <Separator />

              <Section
                title="Integrations"
                description="Optional. Leave a URL empty to skip that component entirely."
              >
                <FormRow>
                  <TextField
                    name="schemaRegistryUrl"
                    label="Schema Registry URL"
                    placeholder="http://schema-registry:8081"
                  />
                  <SelectField
                    name="schemaRegistryType"
                    label="Registry flavour"
                    options={[
                      { value: 'confluent', label: 'Confluent' },
                      { value: 'apicurio', label: 'Apicurio (ccompat)' },
                      { value: 'karapace', label: 'Karapace' },
                    ]}
                  />
                </FormRow>
                {schemaRegistryUrl ? (
                  <FormRow>
                    <TextField name="schemaRegistryUsername" label="Registry username" />
                    <TextField name="schemaRegistryPassword" label="Registry password" password />
                  </FormRow>
                ) : null}

                <TextField
                  name="connectUrl"
                  label="Kafka Connect URL"
                  placeholder="http://connect:8083"
                />
                {connectUrl ? (
                  <FormRow>
                    <TextField name="connectUsername" label="Connect username" />
                    <TextField name="connectPassword" label="Connect password" password />
                  </FormRow>
                ) : null}

                <TextField name="ksqlUrl" label="ksqlDB URL" placeholder="http://ksqldb:8088" />
                {ksqlUrl ? (
                  <FormRow>
                    <TextField name="ksqlUsername" label="ksqlDB username" />
                    <TextField name="ksqlPassword" label="ksqlDB password" password />
                  </FormRow>
                ) : null}

                <FormRow>
                  <TextField name="flinkUrl" label="Flink URL" placeholder="http://flink:8081" />
                  <TextField
                    name="flinkSqlGatewayUrl"
                    label="Flink SQL gateway URL"
                    placeholder="http://flink:8083"
                  />
                </FormRow>

                <TextField
                  name="prometheusUrl"
                  label="Prometheus URL"
                  placeholder="http://prometheus:9090"
                />
                {prometheusUrl ? (
                  <FormRow>
                    <TextField name="prometheusUsername" label="Prometheus username" />
                    <TextField name="prometheusPassword" label="Prometheus password" password />
                  </FormRow>
                ) : null}
              </Section>
            </form>
          </Form>

          {result ? (
            <section className="space-y-2" aria-live="polite">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Results</h3>
                <Badge variant={result.ok ? 'success' : 'danger'} size="sm">
                  {result.ok ? 'All components reachable' : 'Needs attention'}
                </Badge>
                <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
                  {Math.round(result.durationMs)} ms
                </span>
              </div>
              <ul className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                {result.components.map((component) => (
                  <ResultRow key={component.component} result={component} />
                ))}
              </ul>
            </section>
          ) : null}

          {generated ? (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Generated configuration</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadText(generated.yaml, configFilename(clusterId), 'application/yaml')
                  }
                >
                  <Download /> Download
                </Button>
              </div>
              <CodeBlock code={generated.yaml} language="yaml" wrap />
              {generated.envVars.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">
                    Set these environment variables before starting k-shui
                  </p>
                  <CodeBlock code={envSnippet} language="shell" wrap maxHeight={160} />
                </div>
              ) : null}
              <p className="text-2xs leading-5 text-[var(--muted)]">
                Merge the <code>clusters:</code> entry into your <code>k-shui.yaml</code> (or the
                ConfigMap your deployment mounts), export the variables above, then restart k-shui —
                the cluster inventory is read once at startup.
              </p>
            </section>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Tooltip content={disabled ? REQUIRES_ADMIN : undefined}>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                onClick={() => void onGenerate()}
                loading={config.isPending}
                disabled={disabled}
              >
                Generate config only
              </Button>
            </span>
          </Tooltip>
          <Tooltip content={disabled ? REQUIRES_ADMIN : undefined}>
            <span className="inline-flex">
              <Button
                type="submit"
                form="connection-test-form"
                loading={test.isPending}
                disabled={disabled}
              >
                <Play /> Run test
              </Button>
            </span>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Button + dialog pair, so a page only has to drop in one element. */
export function ConnectionTesterButton({
  variant = 'outline',
  label = 'Test a connection',
}: {
  variant?: 'default' | 'outline' | 'secondary';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Play /> {label}
      </Button>
      <ConnectionTesterDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
