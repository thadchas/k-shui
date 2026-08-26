import { useEffect, useState } from 'react';
import { Check, Database, Pencil, X } from 'lucide-react';
import { useSchemaGlobalConfig, useUpdateSchemaGlobalConfig } from '@/api/hooks/schemas';
import type { Compatibility, SchemaRegistryInfo } from '@/api/types';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/error-state';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { COMPATIBILITY_HELP, COMPATIBILITY_OPTIONS } from './schemaUtils';

export interface RegistryInfoCardProps {
  cluster: string;
  info: SchemaRegistryInfo | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** Registry banner: implementation, endpoint, mode and editable global compatibility. */
export function RegistryInfoCard({
  cluster,
  info,
  loading,
  error,
  onRetry,
}: RegistryInfoCardProps) {
  const config = useSchemaGlobalConfig(cluster);
  const updateConfig = useUpdateSchemaGlobalConfig(cluster);
  const { canEdit } = usePermissions();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Compatibility>('BACKWARD');

  useEffect(() => {
    if (config.data?.compatibility) setDraft(config.data.compatibility);
  }, [config.data?.compatibility]);

  if (error) return <InlineError error={error} onRetry={onRetry} />;

  const save = async () => {
    try {
      await updateConfig.mutateAsync(draft);
      toast.success(`Global compatibility set to ${draft}`);
      setEditing(false);
    } catch (e) {
      toastError('Failed to update compatibility', e);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
          <Database className="size-4 text-[var(--primary)]" />
        </span>
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">Registry</p>
          {loading ? (
            <Skeleton className="mt-1 h-4 w-28" />
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              {info?.type ?? 'unknown'}
              {info?.version ? (
                <Badge variant="secondary" size="sm">
                  v{info.version}
                </Badge>
              ) : null}
            </p>
          )}
        </div>
      </div>

      <Field label="Endpoint">
        {loading ? (
          <Skeleton className="h-4 w-56" />
        ) : (
          <Tooltip content={info?.url ?? ''}>
            <span className="block max-w-[340px] truncate font-mono text-[13px]">
              {info?.url ?? '—'}
            </span>
          </Tooltip>
        )}
      </Field>

      <Field label="Mode">
        {loading ? (
          <Skeleton className="h-4 w-20" />
        ) : (
          <StatusPill status={info?.mode ?? 'unknown'} />
        )}
      </Field>

      <Field label="Global compatibility">
        {config.isLoading ? (
          <Skeleton className="h-4 w-24" />
        ) : editing ? (
          <span className="flex items-center gap-1.5">
            <SimpleSelect
              size="sm"
              value={draft}
              onValueChange={(v) => setDraft(v as Compatibility)}
              options={COMPATIBILITY_OPTIONS}
              aria-label="Global compatibility level"
              className="w-52"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Save compatibility"
              loading={updateConfig.isPending}
              onClick={() => void save()}
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => setEditing(false)}
            >
              <X />
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Tooltip
              content={
                config.data?.compatibility
                  ? COMPATIBILITY_HELP[config.data.compatibility]
                  : 'Not reported by this registry'
              }
            >
              <Badge variant="outline">{config.data?.compatibility ?? '—'}</Badge>
            </Tooltip>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit global compatibility"
                  disabled={!canEdit}
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
              </span>
            </Tooltip>
          </span>
        )}
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex h-6 items-center">{children}</div>
    </div>
  );
}
