import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  Cable,
  Keyboard,
  Layers,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import { api } from '@/api/client';
import { useClusters } from '@/api/hooks/clusters';
import type { ConsumerGroupSummary, Page, TopicSummary } from '@/api/types';
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

interface SearchResults {
  topics: TopicSummary[];
  groups: ConsumerGroupSummary[];
}

const EMPTY: SearchResults = { topics: [], groups: [] };

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

async function searchCluster(cluster: string, query: string): Promise<SearchResults> {
  const [topics, groups] = await Promise.all([
    api
      .get<Page<TopicSummary>>(`/clusters/${cluster}/topics`, {
        search: query,
        perPage: 8,
        page: 1,
      })
      .catch(() => null),
    api
      .get<ConsumerGroupSummary[]>(`/clusters/${cluster}/consumer-groups`, { search: query })
      .catch(() => null),
  ]);
  return {
    topics: topics?.items?.slice(0, 8) ?? [],
    groups: (groups ?? []).slice(0, 8),
  };
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
  const needle = debounced.trim().toLowerCase();
  const { data: clusters } = useClusters();

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

  const { data: results = EMPTY, isFetching } = useQuery({
    queryKey: ['command-search', clusterId, debounced],
    queryFn: () => searchCluster(clusterId!, debounced),
    enabled: open && Boolean(clusterId) && debounced.trim().length >= 2,
    staleTime: 15_000,
  });

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
          placeholder="Search pages, topics, consumer groups…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{isFetching ? 'Searching…' : 'No results found'}</CommandEmpty>

          {debounced.trim().length >= 2 && results.topics.length > 0 ? (
            <CommandGroup heading="Topics">
              {results.topics.map((topic) => (
                <CommandItem
                  key={topic.name}
                  value={`topic-${topic.name}`}
                  onSelect={() => go(`/c/${clusterId}/topics/${encodeURIComponent(topic.name)}`)}
                >
                  <Layers />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {topic.name}
                  </span>
                  <CommandShortcut>
                    {topic.partitions}p · rf{topic.replicationFactor}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {debounced.trim().length >= 2 && results.groups.length > 0 ? (
            <CommandGroup heading="Consumer groups">
              {results.groups.map((group) => (
                <CommandItem
                  key={group.groupId}
                  value={`group-${group.groupId}`}
                  onSelect={() =>
                    go(`/c/${clusterId}/consumers/${encodeURIComponent(group.groupId)}`)
                  }
                >
                  <Users />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {group.groupId}
                  </span>
                  <CommandShortcut>lag {group.totalLag}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

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
