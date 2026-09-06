import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Boxes,
  Cable,
  FileJson,
  Keyboard,
  Layers,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
  TriangleAlert,
  Users,
  Workflow,
} from 'lucide-react';
import { api } from '@/api/client';
import { useClusters } from '@/api/hooks/clusters';
import type {
  AlertTrigger,
  ConnectCluster,
  Connector,
  ConsumerGroupSummary,
  FlinkCluster,
  FlinkJob,
  Page,
  SchemaSubjectSummary,
  TopicSummary,
} from '@/api/types';
import { NAV_GROUPS, navHref } from '@/lib/nav';
import { useDebounced } from '@/hooks/useDebounced';
import { useThemeStore } from '@/stores/theme';
import { useUiStore } from '@/stores/ui';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { StatusDot } from '@/components/ui/status-pill';
import {
  applyKindFilter,
  buildSourceGroups,
  flattenSettled,
  isGroupVisible,
  matchesTerm,
  MIN_QUERY_LENGTH,
  parsePaletteQuery,
  PREFIX_HELP,
  RESOURCE_TYPES,
  summarizePaletteSources,
  toAlertResults,
  toConnectorResults,
  toFlinkJobResults,
  toGroupResults,
  toSchemaResults,
  toTopicResults,
  type ConnectorHit,
  type FlinkJobHit,
  type PaletteSourceInput,
  type ResourceKind,
} from '@/components/commandPaletteSources';

const RESULT_ICONS: Record<ResourceKind, typeof Layers> = {
  topic: Layers,
  group: Users,
  connector: Cable,
  flinkJob: Workflow,
  schema: FileJson,
  alert: Bell,
};

/** True when the keystroke happened inside a text field / editor (global shortcuts must not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    Boolean(target.closest('.monaco-editor'))
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Open the command palette' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['/'], label: 'Focus the table search box on the current page' },
  { keys: ['Esc'], label: 'Close dialogs and menus' },
  { keys: ['↑', '↓', 'Enter'], label: 'Navigate and activate rows or palette items' },
];

function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are disabled while typing in a field.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="divide-y divide-[var(--border)]">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-[var(--foreground)]">{s.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {s.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- *
 * Fetchers. Each resource type is its own query so one failing backend cannot
 * blank out the others (`retry: false` — the palette offers an explicit retry).
 * -------------------------------------------------------------------------- */

async function fetchConnectors(cluster: string, term: string): Promise<ConnectorHit[]> {
  const kcs = await api.get<ConnectCluster[]>(`/clusters/${cluster}/connect`);
  if (!kcs?.length) return [];
  const settled = await Promise.allSettled(
    kcs.map(async (kc) => {
      const connectors = await api.get<Connector[]>(
        `/clusters/${cluster}/connect/${encodeURIComponent(kc.name)}/connectors`,
        { search: term },
      );
      return (connectors ?? [])
        .filter((connector) => matchesTerm(term, connector.name, connector.connectorClass))
        .map((connector) => ({ kc: kc.name, connector }));
    }),
  );
  return flattenSettled(settled);
}

async function fetchFlinkJobs(cluster: string, term: string): Promise<FlinkJobHit[]> {
  const fcs = await api.get<FlinkCluster[]>(`/clusters/${cluster}/flink`);
  if (!fcs?.length) return [];
  const settled = await Promise.allSettled(
    fcs.map(async (fc) => {
      const jobs = await api.get<FlinkJob[]>(
        `/clusters/${cluster}/flink/${encodeURIComponent(fc.name)}/jobs`,
      );
      return (jobs ?? [])
        .filter((job) => matchesTerm(term, job.name, job.jid))
        .map((job) => ({ fc: fc.name, job }));
    }),
  );
  return flattenSettled(settled);
}

async function fetchAlertTriggers(term: string): Promise<AlertTrigger[]> {
  const triggers = await api.get<AlertTrigger[]>('/alerts/triggers');
  return (triggers ?? []).filter((trigger) =>
    matchesTerm(term, trigger.name, trigger.metric, trigger.target?.name, trigger.target?.regex),
  );
}

export interface CommandPaletteProps {
  clusterId: string | null;
}

export function CommandPalette({ clusterId }: CommandPaletteProps) {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const debounced = useDebounced(query, 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: clusters } = useClusters();

  const live = useMemo(() => parsePaletteQuery(query), [query]);
  const parsed = useMemo(() => parsePaletteQuery(debounced), [debounced]);
  const term = parsed.term;
  const needle = term.toLowerCase();

  /** Resource search runs once the term is long enough; alerts are not cluster-scoped. */
  const searching = open && parsed.searchable;
  const clusterSearching = searching && Boolean(clusterId);
  const wants = useCallback(
    (kind: ResourceKind) =>
      (kind === 'alert' ? searching : clusterSearching) &&
      (parsed.kind === null || parsed.kind === kind),
    [searching, clusterSearching, parsed.kind],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === '/') {
        const input = document.querySelector<HTMLInputElement>('input[data-table-search]');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const shared = { staleTime: 15_000, retry: false } as const;

  const topicsQuery = useQuery({
    queryKey: ['command-search', 'topics', clusterId, term],
    queryFn: () =>
      api.get<Page<TopicSummary>>(`/clusters/${clusterId}/topics`, {
        search: term,
        perPage: 8,
        page: 1,
      }),
    enabled: wants('topic'),
    ...shared,
  });

  const groupsQuery = useQuery({
    queryKey: ['command-search', 'consumer-groups', clusterId, term],
    queryFn: () =>
      api.get<ConsumerGroupSummary[]>(`/clusters/${clusterId}/consumer-groups`, { search: term }),
    enabled: wants('group'),
    ...shared,
  });

  const connectorsQuery = useQuery({
    queryKey: ['command-search', 'connectors', clusterId, term],
    queryFn: () => fetchConnectors(clusterId!, term),
    enabled: wants('connector'),
    ...shared,
  });

  const flinkQuery = useQuery({
    queryKey: ['command-search', 'flink-jobs', clusterId, term],
    queryFn: () => fetchFlinkJobs(clusterId!, term),
    enabled: wants('flinkJob'),
    ...shared,
  });

  const schemasQuery = useQuery({
    queryKey: ['command-search', 'schemas', clusterId, term],
    queryFn: () =>
      api.get<SchemaSubjectSummary[]>(`/clusters/${clusterId}/schemas/subjects`, { search: term }),
    enabled: wants('schema'),
    ...shared,
  });

  const alertsQuery = useQuery({
    queryKey: ['command-search', 'alert-triggers', term],
    queryFn: () => fetchAlertTriggers(term),
    enabled: wants('alert'),
    ...shared,
  });

  const sources = useMemo<PaletteSourceInput[]>(() => {
    const c = clusterId ?? '';
    return [
      {
        kind: 'topic',
        enabled: wants('topic'),
        isLoading: topicsQuery.isLoading,
        isError: topicsQuery.isError,
        error: topicsQuery.error,
        results: toTopicResults(topicsQuery.data?.items ?? [], c),
      },
      {
        kind: 'group',
        enabled: wants('group'),
        isLoading: groupsQuery.isLoading,
        isError: groupsQuery.isError,
        error: groupsQuery.error,
        results: toGroupResults(groupsQuery.data ?? [], c),
      },
      {
        kind: 'connector',
        enabled: wants('connector'),
        isLoading: connectorsQuery.isLoading,
        isError: connectorsQuery.isError,
        error: connectorsQuery.error,
        results: toConnectorResults(connectorsQuery.data ?? [], c),
      },
      {
        kind: 'flinkJob',
        enabled: wants('flinkJob'),
        isLoading: flinkQuery.isLoading,
        isError: flinkQuery.isError,
        error: flinkQuery.error,
        results: toFlinkJobResults(flinkQuery.data ?? [], c),
      },
      {
        kind: 'schema',
        enabled: wants('schema'),
        isLoading: schemasQuery.isLoading,
        isError: schemasQuery.isError,
        error: schemasQuery.error,
        results: toSchemaResults(schemasQuery.data ?? [], c),
      },
      {
        kind: 'alert',
        enabled: wants('alert'),
        isLoading: alertsQuery.isLoading,
        isError: alertsQuery.isError,
        error: alertsQuery.error,
        results: toAlertResults(alertsQuery.data ?? []),
      },
    ];
  }, [
    clusterId,
    wants,
    topicsQuery.isLoading,
    topicsQuery.isError,
    topicsQuery.error,
    topicsQuery.data,
    groupsQuery.isLoading,
    groupsQuery.isError,
    groupsQuery.error,
    groupsQuery.data,
    connectorsQuery.isLoading,
    connectorsQuery.isError,
    connectorsQuery.error,
    connectorsQuery.data,
    flinkQuery.isLoading,
    flinkQuery.isError,
    flinkQuery.error,
    flinkQuery.data,
    schemasQuery.isLoading,
    schemasQuery.isError,
    schemasQuery.error,
    schemasQuery.data,
    alertsQuery.isLoading,
    alertsQuery.isError,
    alertsQuery.error,
    alertsQuery.data,
  ]);

  const groups = useMemo(
    () => buildSourceGroups(sources, { kind: parsed.kind }),
    [sources, parsed.kind],
  );
  const visibleGroups = useMemo(() => groups.filter(isGroupVisible), [groups]);
  const summary = useMemo(
    () => summarizePaletteSources(groups, { searched: searching }),
    [groups, searching],
  );

  const retry = useCallback(
    (kind: ResourceKind) => {
      const byKind: Record<ResourceKind, () => void> = {
        topic: () => void topicsQuery.refetch(),
        group: () => void groupsQuery.refetch(),
        connector: () => void connectorsQuery.refetch(),
        flinkJob: () => void flinkQuery.refetch(),
        schema: () => void schemasQuery.refetch(),
        alert: () => void alertsQuery.refetch(),
      };
      byKind[kind]();
      inputRef.current?.focus();
    },
    [topicsQuery, groupsQuery, connectorsQuery, flinkQuery, schemasQuery, alertsQuery],
  );

  const setKindFilter = useCallback(
    (kind: ResourceKind | null) => {
      setQuery((current) => applyKindFilter(current, kind));
      inputRef.current?.focus();
    },
    [setQuery],
  );

  const go = (to: string) => {
    setOpen(false);
    void navigate(to);
  };

  const navItems = useMemo(
    () =>
      NAV_GROUPS.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          group: group.label,
          href: navHref(item, clusterId),
        })),
      ),
    [clusterId],
  );

  const taskItems = useMemo(
    () =>
      clusterId
        ? [
            {
              value: 'task-create-topic',
              label: 'Create topic',
              icon: Plus,
              href: `/c/${clusterId}/topics/new`,
            },
            {
              value: 'task-new-connector',
              label: 'New connector',
              icon: Cable,
              href: `/c/${clusterId}/connect`,
            },
            {
              value: 'task-reset-offsets',
              label: 'Reset offsets…',
              icon: RotateCcw,
              href: `/c/${clusterId}/consumers`,
            },
          ]
        : [],
    [clusterId],
  );

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput
          ref={inputRef}
          placeholder="Search pages, topics, groups, connectors, jobs, schemas, alerts…"
          value={query}
          onValueChange={setQuery}
        />

        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
          <span className="mr-1 text-2xs uppercase tracking-wide text-[var(--muted)]">Filter</span>
          <FilterChip active={live.kind === null} onClick={() => setKindFilter(null)}>
            All
          </FilterChip>
          {RESOURCE_TYPES.map((type) => (
            <FilterChip
              key={type.kind}
              active={live.kind === type.kind}
              onClick={() => setKindFilter(live.kind === type.kind ? null : type.kind)}
            >
              {type.chip}
            </FilterChip>
          ))}
        </div>

        <CommandList>
          <CommandEmpty>No results found</CommandEmpty>

          {!live.term ? (
            <div className="px-3 py-2 text-2xs leading-relaxed text-[var(--muted)]">
              Type at least {MIN_QUERY_LENGTH} characters to search topics, consumer groups,
              connectors, Flink jobs, schemas and alerts. Narrow with a type prefix:{' '}
              <span className="font-mono text-[var(--foreground)]">{PREFIX_HELP.join(' · ')}</span>
            </div>
          ) : null}

          {summary.message ? (
            <div
              className={
                summary.state === 'partial' || summary.state === 'unavailable'
                  ? 'px-3 py-2 text-2xs text-[var(--warning)]'
                  : 'px-3 py-2 text-2xs text-[var(--muted)]'
              }
            >
              {summary.message}
            </div>
          ) : null}

          {visibleGroups.map((group) => {
            const Icon = RESULT_ICONS[group.kind];
            return (
              <CommandGroup key={group.kind} heading={group.label}>
                {group.status === 'unavailable' ? (
                  <CommandItem
                    value={`retry-${group.kind}`}
                    onSelect={() => retry(group.kind)}
                    title={group.detail ?? undefined}
                  >
                    <TriangleAlert />
                    <span className="min-w-0 flex-1 truncate">{group.message}</span>
                    <CommandShortcut>Retry</CommandShortcut>
                  </CommandItem>
                ) : (
                  group.results.map((result) => (
                    <CommandItem key={result.id} value={result.id} onSelect={() => go(result.href)}>
                      <Icon />
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        {result.title}
                      </span>
                      {result.meta ? <CommandShortcut>{result.meta}</CommandShortcut> : null}
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            );
          })}

          <CommandGroup heading="Navigate">
            {navItems
              .filter((item) => !needle || item.label.toLowerCase().includes(needle))
              .map((item) => (
                <CommandItem
                  key={`${item.group}-${item.label}`}
                  value={`nav-${item.group}-${item.label}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon />
                  <span className="flex-1">{item.label}</span>
                  <CommandShortcut>{item.group}</CommandShortcut>
                </CommandItem>
              ))}
          </CommandGroup>

          {clusters && clusters.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Clusters">
                {clusters
                  .filter(
                    (c) =>
                      !needle ||
                      c.name.toLowerCase().includes(needle) ||
                      c.id.toLowerCase().includes(needle),
                  )
                  .map((cluster) => (
                    <CommandItem
                      key={cluster.id}
                      value={`cluster-${cluster.id}`}
                      onSelect={() => go(`/c/${cluster.id}/overview`)}
                    >
                      <StatusDot status={cluster.status} />
                      <span className="flex-1 truncate">{cluster.name}</span>
                      <CommandShortcut>{cluster.id}</CommandShortcut>
                    </CommandItem>
                  ))}
                <CommandItem value="all-clusters" onSelect={() => go('/clusters')}>
                  <Boxes />
                  All clusters
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}

          {clusterId ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tasks">
                {taskItems
                  .filter((t) => !needle || t.label.toLowerCase().includes(needle))
                  .map((t) => (
                    <CommandItem key={t.value} value={t.value} onSelect={() => go(t.href)}>
                      <t.icon />
                      <span className="flex-1">{t.label}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </>
          ) : null}

          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem
              value="theme-light"
              onSelect={() => {
                setThemeMode('light');
                setOpen(false);
              }}
            >
              <Sun /> Switch to light theme
            </CommandItem>
            <CommandItem
              value="theme-dark"
              onSelect={() => {
                setThemeMode('dark');
                setOpen(false);
              }}
            >
              <Moon /> Switch to dark theme
            </CommandItem>
            <CommandItem value="audit-log" onSelect={() => go('/audit')}>
              <Search /> Open audit log
            </CommandItem>
            <CommandItem
              value="keyboard-shortcuts"
              onSelect={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            >
              <Keyboard /> Keyboard shortcuts
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-full border px-2 py-0.5 text-2xs transition-colors',
        active
          ? 'border-[var(--accent)] bg-[var(--surface-2)] text-[var(--foreground)]'
          : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
