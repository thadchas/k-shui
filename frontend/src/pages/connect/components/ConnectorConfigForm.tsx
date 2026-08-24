import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type {
  ConnectorConfigDefinitionDetail,
  ConnectorValidationEntry,
  ConnectorValidationResult,
} from '@/api/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { IMPORTANCE_ORDER, inputKind } from './connectUtils';

export interface ConnectorConfigFormProps {
  validation: ConnectorValidationResult | undefined;
  loading?: boolean;
  config: Record<string, string>;
  onChange: (name: string, value: string) => void;
  /** Groups that start expanded; the rest collapse to keep the form scannable. */
  defaultOpenGroups?: string[];
  disabled?: boolean;
}

interface Section {
  group: string;
  entries: ConnectorValidationEntry[];
  errorCount: number;
}

/**
 * Renders a connector configuration form from `PUT /plugins/{class}/validate`:
 * groups become sections, definitions become typed inputs, recommended values
 * become selects, and per-field errors are surfaced inline.
 */
export function ConnectorConfigForm({
  validation,
  loading,
  config,
  onChange,
  defaultOpenGroups = ['Common'],
  disabled,
}: ConnectorConfigFormProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections = useMemo<Section[]>(() => {
    const entries = (validation?.configs ?? []) as ConnectorValidationEntry[];
    const order = validation?.groups ?? [];
    const byGroup = new Map<string, ConnectorValidationEntry[]>();

    for (const entry of entries) {
      if (entry.value?.visible === false) continue;
      const group = entry.definition?.group ?? 'Other';
      const list = byGroup.get(group) ?? [];
      list.push(entry);
      byGroup.set(group, list);
    }

    const groupNames = [
      ...order.filter((g) => byGroup.has(g)),
      ...Array.from(byGroup.keys()).filter((g) => !order.includes(g)),
    ];

    return groupNames.map((group) => {
      const list = [...(byGroup.get(group) ?? [])].sort((a, b) => {
        const orderA = a.definition?.order ?? null;
        const orderB = b.definition?.order ?? null;
        if (orderA !== null && orderB !== null && orderA !== orderB) return orderA - orderB;
        const importanceA = IMPORTANCE_ORDER[a.definition?.importance ?? 'LOW'] ?? 3;
        const importanceB = IMPORTANCE_ORDER[b.definition?.importance ?? 'LOW'] ?? 3;
        if (importanceA !== importanceB) return importanceA - importanceB;
        return (a.definition?.name ?? '').localeCompare(b.definition?.name ?? '');
      });
      return {
        group,
        entries: list,
        errorCount: list.reduce((sum, e) => sum + (e.value?.errors?.length ?? 0), 0),
      };
    });
  }, [validation]);

  if (loading && sections.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', loading && 'opacity-70 transition-opacity')}>
      {sections.map((section) => {
        const isCollapsed =
          collapsed[section.group] ??
          (!defaultOpenGroups.includes(section.group) && section.errorCount === 0);
        return (
          <section
            key={section.group}
            className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 bg-[var(--surface-2)] px-3 py-2 text-left"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((prev) => ({ ...prev, [section.group]: !isCollapsed }))}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5 text-[var(--muted)]" />
              ) : (
                <ChevronDown className="size-3.5 text-[var(--muted)]" />
              )}
              <span className="text-xs font-semibold">{section.group}</span>
              <Badge variant="secondary" size="sm">
                {section.entries.length}
              </Badge>
              {section.errorCount > 0 ? (
                <Badge variant="danger" size="sm">
                  {section.errorCount} error{section.errorCount === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </button>

            {!isCollapsed ? (
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {section.entries.map((entry) => (
                  <ConfigField
                    key={entry.definition.name}
                    entry={entry}
                    value={config[entry.definition.name] ?? ''}
                    onChange={onChange}
                    disabled={disabled}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ConfigField({
  entry,
  value,
  onChange,
  disabled,
}: {
  entry: ConnectorValidationEntry;
  value: string;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
}) {
  const definition = entry.definition as ConnectorConfigDefinitionDetail;
  const recommended = entry.value?.recommendedValues ?? [];
  const errors = entry.value?.errors ?? [];
  const kind = inputKind(definition.type, recommended);
  const id = `cfg-${definition.name}`;
  const invalid = errors.length > 0;
  const wide = kind === 'list' || (definition.width ?? '').toUpperCase() === 'LONG';

  return (
    <div className={cn('min-w-0 space-y-1.5', wide && 'md:col-span-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={id} className="truncate">
          {definition.displayName || definition.name}
          {definition.required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
        </Label>
        <Tooltip content={<span className="font-mono text-2xs">{definition.name}</span>}>
          <Badge variant="secondary" size="sm" className="font-mono">
            {definition.type?.toLowerCase()}
          </Badge>
        </Tooltip>
        {definition.importance === 'HIGH' ? (
          <Badge variant="outline" size="sm">
            important
          </Badge>
        ) : null}
      </div>

      {kind === 'boolean' ? (
        <div className="flex h-8 items-center gap-2">
          <Switch
            id={id}
            disabled={disabled}
            checked={(value || definition.defaultValue || 'false') === 'true'}
            onCheckedChange={(v) => onChange(definition.name, String(v))}
            aria-label={definition.name}
          />
          <span className="font-mono text-2xs text-[var(--muted)]">
            {value || definition.defaultValue || 'false'}
          </span>
        </div>
      ) : kind === 'select' ? (
        <SimpleSelect
          value={value || undefined}
          onValueChange={(v) => onChange(definition.name, v)}
          options={recommended.map((r) => ({ label: r, value: r }))}
          placeholder={definition.defaultValue ?? 'Select…'}
          disabled={disabled}
          aria-label={definition.name}
        />
      ) : (
        <Input
          id={id}
          mono
          invalid={invalid}
          disabled={disabled}
          type={kind === 'password' ? 'password' : kind === 'number' ? 'number' : 'text'}
          autoComplete="off"
          value={value}
          placeholder={definition.defaultValue ?? (kind === 'list' ? 'a,b,c' : '')}
          onChange={(e) => onChange(definition.name, e.target.value)}
        />
      )}

      {errors.length > 0 ? (
        <ul className="space-y-0.5">
          {errors.map((error, index) => (
            <li
              key={index}
              className="flex items-start gap-1 text-2xs leading-4 text-[var(--danger)]"
            >
              <AlertCircle className="mt-px size-3 shrink-0" />
              <span>{error}</span>
            </li>
          ))}
        </ul>
      ) : definition.documentation ? (
        <p className="line-clamp-3 text-2xs leading-4 text-[var(--muted)]">
          {definition.documentation}
        </p>
      ) : null}
    </div>
  );
}
