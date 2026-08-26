import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { useCreateTopic } from '@/api/hooks/topics';
import { useBrokers } from '@/api/hooks/brokers';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { RETENTION_PRESETS, formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
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
import { KeyValueEditor, pairsToRecord, type KeyValuePair } from '@/components/ui/key-value-editor';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

const TOPIC_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const schema = z.object({
  name: z
    .string()
    .min(1, 'Topic name is required')
    .max(249, 'Topic names are limited to 249 characters')
    .regex(TOPIC_NAME_RE, 'Only letters, digits, dot, underscore and hyphen are allowed')
    .refine((v) => v !== '.' && v !== '..', 'Invalid topic name'),
  // zod 4 types the *input* of `z.coerce.number()` as `unknown` unless it is given
  // explicitly. These fields are bound to <input type="number">, which hands react-hook-form
  // a string, so pin the input type to keep `z.input<typeof schema>` assignable to the DOM.
  partitions: z.coerce.number<string | number>().int().min(1, 'At least 1 partition').max(100_000),
  replicationFactor: z.coerce.number<string | number>().int().min(1, 'At least 1 replica').max(32),
  cleanupPolicy: z.enum(['delete', 'compact', 'compact,delete']),
  retentionMs: z.coerce.number<string | number>().int(),
  minInsyncReplicas: z.coerce.number<string | number>().int().min(1).max(32),
});

type FormValues = z.input<typeof schema>;

const CONFIG_SUGGESTIONS = [
  'max.message.bytes',
  'segment.bytes',
  'segment.ms',
  'retention.bytes',
  'compression.type',
  'delete.retention.ms',
  'min.cleanable.dirty.ratio',
  'message.timestamp.type',
  'unclean.leader.election.enable',
];

export function NewTopicPage() {
  const cluster = useClusterId();
  const { canEdit } = usePermissions();
  const navigate = useNavigate();
  const createTopic = useCreateTopic(cluster);
  const brokers = useBrokers(cluster);
  const [extraConfigs, setExtraConfigs] = useState<KeyValuePair[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      partitions: 3,
      replicationFactor: Math.min(3, Math.max(1, brokers.data?.length ?? 1)),
      cleanupPolicy: 'delete',
      retentionMs: 604_800_000,
      minInsyncReplicas: 1,
    },
  });

  const onSubmit = form.handleSubmit(async (raw) => {
    if (!canEdit) return;
    const values = schema.parse(raw);
    const configs: Record<string, string> = {
      'cleanup.policy': values.cleanupPolicy,
      'retention.ms': String(values.retentionMs),
      'min.insync.replicas': String(values.minInsyncReplicas),
      ...pairsToRecord(extraConfigs),
    };
    try {
      await createTopic.mutateAsync({
        name: values.name,
        partitions: values.partitions,
        replicationFactor: values.replicationFactor,
        configs,
      });
      toast.success(`Topic ${values.name} created`);
      void navigate(`/c/${cluster}/topics/${encodeURIComponent(values.name)}`);
    } catch (e) {
      toastError('Failed to create topic', e);
    }
  });

  const brokerCount = brokers.data?.length ?? 0;
  const retentionValue = form.watch('retentionMs');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New topic"
        description="Create a Kafka topic with the settings below."
        actions={
          <Button variant="outline" onClick={() => void navigate(`/c/${cluster}/topics`)}>
            <ArrowLeft /> Cancel
          </Button>
        }
      />

      <Form {...form}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Card>
            <CardToolbarHeader title="Basics" />
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Topic name</FormLabel>
                    <FormControl>
                      <Input {...field} mono autoFocus placeholder="orders.v1" autoComplete="off" />
                    </FormControl>
                    <FormDescription>
                      Letters, digits, <code>.</code>, <code>_</code> and <code>-</code>. Avoid
                      mixing
                      <code> .</code> and <code>_</code> — Kafka metric names collide.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormRow>
                <FormField
                  control={form.control}
                  name="partitions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Partitions</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} />
                      </FormControl>
                      <FormDescription>Determines maximum consumer parallelism.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="replicationFactor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Replication factor</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} max={brokerCount || undefined} />
                      </FormControl>
                      <FormDescription>
                        {brokerCount > 0
                          ? `Cluster has ${brokerCount} broker${brokerCount === 1 ? '' : 's'}.`
                          : 'Must not exceed broker count.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormRow>
            </CardContent>
          </Card>

          <Card>
            <CardToolbarHeader title="Retention & compaction" />
            <CardContent className="space-y-4">
              <FormRow>
                <FormField
                  control={form.control}
                  name="cleanupPolicy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cleanup policy</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="delete">delete — drop old segments</SelectItem>
                          <SelectItem value="compact">compact — keep latest per key</SelectItem>
                          <SelectItem value="compact,delete">compact,delete — both</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minInsyncReplicas"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>min.insync.replicas</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={1} />
                      </FormControl>
                      <FormDescription>
                        Minimum replicas that must ack an <code>acks=all</code> produce.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormRow>

              <FormField
                control={form.control}
                name="retentionMs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Retention</FormLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {RETENTION_PRESETS.map((preset) => (
                        <Button
                          key={preset.value}
                          type="button"
                          variant={Number(retentionValue) === preset.value ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => field.onChange(preset.value)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                    <FormControl>
                      <Input {...field} type="number" className="mt-2" />
                    </FormControl>
                    <FormDescription>
                      retention.ms ={' '}
                      {Number(retentionValue) < 0
                        ? 'unlimited'
                        : formatDuration(Number(retentionValue))}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardToolbarHeader
              title="Custom configs"
              description="Any additional topic-level config overrides."
            />
            <CardContent>
              <KeyValueEditor
                value={extraConfigs}
                onChange={setExtraConfigs}
                keyPlaceholder="config.name"
                valuePlaceholder="value"
                addLabel="Add config"
                keySuggestions={CONFIG_SUGGESTIONS}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate(`/c/${cluster}/topics`)}
            >
              Cancel
            </Button>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button type="submit" loading={createTopic.isPending} disabled={!canEdit}>
                  Create topic
                </Button>
              </span>
            </Tooltip>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default NewTopicPage;
