import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, ListTree, Table2, Waves } from 'lucide-react';
import type { KsqlQueryInfo, KsqlStream, KsqlTable } from '@/api/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { InlineError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';

export type KsqlObjectKind = 'stream' | 'table' | 'query';

export interface KsqlSidebarProps {
  streams: KsqlStream[] | undefined;
  tables: KsqlTable[] | undefined;
  queries: KsqlQueryInfo[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  selected?: { kind: KsqlObjectKind; name: string } | null;
  onSelect: (kind: KsqlObjectKind, name: string) => void;
}

/** Streams / Tables / Queries tree with counts. */
export function KsqlSidebar({
  streams,
  tables,
  queries,
  loading,
  error,
  onRetry,
  selected,
  onSelect,
}: KsqlSidebarProps) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({
    streams: true,
    tables: true,
    queries: true,
  });

  const term = filter.trim().toLowerCase();
  const match = (name: string) => !term || name.toLowerCase().includes(term);

  const streamItems = (streams ?? []).filter((s) => match(s.name));
  const tableItems = (tables ?? []).filter((t) => match(t.name));
  const queryItems = (queries ?? []).filter((q) => match(q.id));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter objects…"
        aria-label="Filter ksqlDB objects"
      />

      {error ? <InlineError error={error} onRetry={onRetry} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="space-y-2 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Group
              icon={Waves}
              label="Streams"
              count={streamItems.length}
              open={open.streams}
              onToggle={() => setOpen((p) => ({ ...p, streams: !p.streams }))}
            >
              {streamItems.map((stream) => (
                <Item
                  key={stream.name}
                  label={stream.name}
                  hint={`${stream.topic} · ${stream.valueFormat}`}
                  active={selected?.kind === 'stream' && selected.name === stream.name}
                  onClick={() => onSelect('stream', stream.name)}
                />
              ))}
            </Group>

            <Group
              icon={Table2}
              label="Tables"
              count={tableItems.length}
              open={open.tables}
              onToggle={() => setOpen((p) => ({ ...p, tables: !p.tables }))}
            >
              {tableItems.map((table) => (
                <Item
                  key={table.name}
                  label={table.name}
                  hint={`${table.topic} · ${table.valueFormat}`}
                  active={selected?.kind === 'table' && selected.name === table.name}
                  onClick={() => onSelect('table', table.name)}
                />
              ))}
            </Group>

            <Group
              icon={ListTree}
              label="Queries"
              count={queryItems.length}
              open={open.queries}
              onToggle={() => setOpen((p) => ({ ...p, queries: !p.queries }))}
            >
              {queryItems.map((query) => (
                <Item
                  key={query.id}
                  label={query.id}
                  hint={query.sinks?.join(', ') || query.state || ''}
                  active={selected?.kind === 'query' && selected.name === query.id}
                  onClick={() => onSelect('query', query.id)}
                />
              ))}
            </Group>

            {streamItems.length + tableItems.length + queryItems.length === 0 ? (
              <p className="px-2 py-6 text-center text-2xs text-[var(--muted)]">
                {term ? 'Nothing matches your filter.' : 'No streams, tables or queries yet.'}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Group({
  icon: Icon,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  icon: typeof Layers;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-xs font-semibold hover:bg-[var(--surface-2)]"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-[var(--muted)]" />
        ) : (
          <ChevronRight className="size-3.5 text-[var(--muted)]" />
        )}
        <Icon className="size-3.5 text-[var(--primary)]" />
        {label}
        <Badge variant="secondary" size="sm" className="ml-auto">
          {count}
        </Badge>
      </button>
      {open ? <div className="mt-0.5 space-y-0.5 pl-4">{children}</div> : null}
    </div>
  );
}

function Item({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={hint ? <span className="font-mono text-2xs">{hint}</span> : ''}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'block w-full truncate rounded-[var(--radius-control)] px-2 py-1 text-left font-mono text-2xs transition-colors',
          active
            ? 'bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]'
            : 'text-[var(--foreground)] hover:bg-[var(--surface-2)]',
        )}
      >
        {label}
      </button>
    </Tooltip>
  );
}
