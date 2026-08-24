import { useMemo } from 'react';
import { useBrokers } from '@/api/hooks/brokers';
import { useConnectClusters, useConnectors } from '@/api/hooks/connect';
import { useConsumerGroups } from '@/api/hooks/consumerGroups';
import { useFlinkClusterList, useFlinkJobs } from '@/api/hooks/flink';
import { useKsqlClusters, useKsqlQueries } from '@/api/hooks/ksql';
import { useTopics } from '@/api/hooks/topics';
import type { AlertComponent } from '@/api/types';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TARGETED_COMPONENTS } from '../alertsLib';

export interface TargetPickerProps {
  cluster: string | null;
  component: AlertComponent;
  name: string;
  regex: string;
  usePattern: boolean;
  onUsePatternChange: (value: boolean) => void;
  onNameChange: (value: string) => void;
  onRegexChange: (value: string) => void;
}

/**
 * Target selector: a combobox fed by the list API for the chosen component, or
 * a free-form regex pattern.
 */
export function TargetPicker({
  cluster,
  component,
  name,
  regex,
  usePattern,
  onUsePatternChange,
  onNameChange,
  onRegexChange,
}: TargetPickerProps) {
  const scoped = cluster ?? undefined;
  const wants = (c: AlertComponent) => (component === c ? scoped : undefined);

  const topics = useTopics(wants('topic'), { perPage: 500 });
  const groups = useConsumerGroups(wants('consumerGroup'), {});
  const brokers = useBrokers(wants('broker'));
  const connectClusters = useConnectClusters(wants('connector'));
  const firstKc = connectClusters.data?.[0]?.name;
  const connectors = useConnectors(wants('connector'), firstKc);
  const flinkClusters = useFlinkClusterList(wants('flinkJob'));
  const firstFc = flinkClusters.data?.[0]?.name;
  const flinkJobs = useFlinkJobs(wants('flinkJob'), firstFc);
  const ksqlClusters = useKsqlClusters(wants('ksqlQuery'));
  const firstKsql = ksqlClusters.data?.[0]?.name;
  const ksqlQueries = useKsqlQueries(wants('ksqlQuery'), firstKsql);

  const { options, loading, placeholder } = useMemo((): {
    options: ComboboxOption[];
    loading: boolean;
    placeholder: string;
  } => {
    switch (component) {
      case 'topic':
        return {
          options: (topics.data?.items ?? []).map((t) => ({ label: t.name, value: t.name })),
          loading: topics.isLoading,
          placeholder: 'Select a topic…',
        };
      case 'consumerGroup':
        return {
          options: (groups.data ?? []).map((g) => ({ label: g.groupId, value: g.groupId })),
          loading: groups.isLoading,
          placeholder: 'Select a consumer group…',
        };
      case 'broker':
        return {
          options: (brokers.data ?? []).map((b) => ({
            label: `${b.id} · ${b.host}:${b.port}`,
            value: String(b.id),
          })),
          loading: brokers.isLoading,
          placeholder: 'Select a broker…',
        };
      case 'connector':
        return {
          options: (connectors.data ?? []).map((c) => ({
            label: c.name,
            value: c.name,
            description: c.connectorClass,
          })),
          loading: connectors.isLoading || connectClusters.isLoading,
          placeholder: 'Select a connector…',
        };
      case 'flinkJob':
        return {
          options: (flinkJobs.data ?? []).map((j) => ({
            label: j.name,
            value: j.name,
            description: j.jid,
          })),
          loading: flinkJobs.isLoading || flinkClusters.isLoading,
          placeholder: 'Select a Flink job…',
        };
      case 'ksqlQuery':
        return {
          options: (ksqlQueries.data ?? []).map((q) => ({ label: q.id, value: q.id })),
          loading: ksqlQueries.isLoading || ksqlClusters.isLoading,
          placeholder: 'Select a query…',
        };
      default:
        return { options: [], loading: false, placeholder: 'Not applicable' };
    }
  }, [
    component,
    topics.data,
    topics.isLoading,
    groups.data,
    groups.isLoading,
    brokers.data,
    brokers.isLoading,
    connectors.data,
    connectors.isLoading,
    connectClusters.isLoading,
    flinkJobs.data,
    flinkJobs.isLoading,
    flinkClusters.isLoading,
    ksqlQueries.data,
    ksqlQueries.isLoading,
    ksqlClusters.isLoading,
  ]);

  const applicable = TARGETED_COMPONENTS.includes(component);

  if (!applicable) {
    return (
      <div className="space-y-1.5">
        <Label>Target</Label>
        <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          {component === 'custom'
            ? 'Custom triggers evaluate a PromQL expression — no target needed.'
            : 'This component applies to the whole cluster — no target needed.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="alert-target">Target</Label>
        <label className="flex items-center gap-2 text-2xs text-[var(--muted)]">
          <Switch
            checked={usePattern}
            onCheckedChange={onUsePatternChange}
            aria-label="Match by pattern"
          />
          Match by pattern
        </label>
      </div>

      {usePattern ? (
        <>
          <Input
            id="alert-target"
            value={regex}
            onChange={(e) => onRegexChange(e.target.value)}
            placeholder="orders\\..*"
            className="font-mono"
          />
          <p className="text-2xs text-[var(--muted)]">
            A regular expression evaluated against every {component} on each interval.
          </p>
        </>
      ) : !cluster ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          Pick a cluster first to browse its {component}s, or switch to pattern matching.
        </p>
      ) : options.length === 0 && !loading ? (
        <>
          <Input
            id="alert-target"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter a name"
            className="font-mono"
          />
          <p className="text-2xs text-[var(--muted)]">
            Nothing to list for this component — enter the name manually.
          </p>
        </>
      ) : (
        <Combobox
          className="w-full"
          options={options}
          value={name || null}
          onValueChange={(v) => onNameChange(v ?? '')}
          placeholder={placeholder}
          searchPlaceholder="Search…"
          emptyText={loading ? 'Loading…' : 'No matches'}
          loading={loading}
          clearable
        />
      )}
    </div>
  );
}
