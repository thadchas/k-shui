import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Puzzle } from 'lucide-react';
import type { ConnectorPlugin } from '@/api/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { shortClass } from './connectUtils';

export interface PluginGridProps {
  plugins: ConnectorPlugin[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  selected?: string | null;
  onSelect: (plugin: ConnectorPlugin) => void;
}

/** Step 1 of the connector wizard: pick a plugin. */
export function PluginGrid({
  plugins,
  loading,
  error,
  onRetry,
  selected,
  onSelect,
}: PluginGridProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const types = useMemo(
    () => Array.from(new Set((plugins ?? []).map((p) => p.type))).sort(),
    [plugins],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (plugins ?? [])
      .filter((plugin) => {
        if (typeFilter !== 'all' && plugin.type !== typeFilter) return false;
        return !term || plugin.class.toLowerCase().includes(term);
      })
      .sort((a, b) => shortClass(a.class).localeCompare(shortClass(b.class)));
  }, [plugins, search, typeFilter]);

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plugins…"
          aria-label="Search plugins"
          className="max-w-xs"
        />
        <SimpleSelect
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={[
            { label: 'All types', value: 'all' },
            ...types.map((t) => ({ label: t, value: t })),
          ]}
          aria-label="Filter by plugin type"
          className="w-36"
        />
        <span className="ml-auto text-2xs text-[var(--muted)]">{filtered.length} plugins</span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState
            icon={Puzzle}
            title={search ? 'No plugins match your search' : 'No plugins installed'}
            description={
              search
                ? 'Try a different search term.'
                : 'Install connector plugins on the Connect workers to create connectors.'
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((plugin) => {
            const isSelected = selected === plugin.class;
            const Icon = plugin.type === 'source' ? ArrowUpFromLine : ArrowDownToLine;
            return (
              <button
                key={`${plugin.class}-${plugin.version ?? ''}`}
                type="button"
                onClick={() => onSelect(plugin)}
                aria-pressed={isSelected}
                className={cn(
                  'flex flex-col gap-2 rounded-[var(--radius-card)] border bg-[var(--surface)] p-4 text-left shadow-[var(--shadow-card)] transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]',
                  isSelected
                    ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]'
                    : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
                      <Icon className="size-3.5 text-[var(--primary)]" />
                    </span>
                    <span className="truncate text-[13px] font-medium">
                      {shortClass(plugin.class)}
                    </span>
                  </span>
                  <Badge variant={plugin.type === 'source' ? 'accent' : 'info'} size="sm">
                    {plugin.type}
                  </Badge>
                </div>
                <Tooltip content={<span className="font-mono text-2xs">{plugin.class}</span>}>
                  <span className="truncate font-mono text-2xs text-[var(--muted)]">
                    {plugin.class}
                  </span>
                </Tooltip>
                {plugin.version ? (
                  <span className="font-mono text-2xs text-[var(--muted)]">v{plugin.version}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
