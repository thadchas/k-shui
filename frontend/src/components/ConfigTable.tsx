import { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Lock, Pencil, RotateCcw, X } from 'lucide-react';
import type { ConfigEntry } from '@/api/types';
import { cn, isSensitiveConfigName } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { REQUIRES_EDITOR } from '@/hooks/usePermissions';

const MASK = '••••••••';

export interface ConfigTableProps {
  configs: ConfigEntry[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Enables inline edit + diff/confirm. Omit for read-only. */
  onSave?: (changes: Record<string, string | null>) => Promise<void> | void;
  saving?: boolean;
  /**
   * Keep the edit column visible but disable editing (e.g. viewer role). Pending drafts are
   * kept but cannot be applied; tooltips explain why.
   */
  readOnly?: boolean;
  /** Tooltip shown on disabled edit controls when `readOnly`. */
  readOnlyReason?: string;
  className?: string;
  title?: string;
  description?: string;
}

interface PendingChange {
  name: string;
  from: string;
  to: string;
}

export function ConfigTable({
  configs,
  loading,
  error,
  onRetry,
  onSave,
  saving,
  readOnly = false,
  readOnlyReason = REQUIRES_EDITOR,
  className,
}: ConfigTableProps) {
  const [search, setSearch] = useState('');
  const [showDefaults, setShowDefaults] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rows = useMemo(() => {
    const list = configs ?? [];
    const q = search.trim().toLowerCase();
    return list
      .filter((c) => (showDefaults ? true : !c.isDefault || c.name in drafts))
      .filter(
        (c) => !q || c.name.toLowerCase().includes(q) || (c.value ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [configs, search, showDefaults, drafts]);

  const changes: PendingChange[] = useMemo(() => {
    const byName = new Map((configs ?? []).map((c) => [c.name, c]));
    return Object.entries(drafts)
      .filter(([name, to]) => (byName.get(name)?.value ?? '') !== to)
      .map(([name, to]) => ({ name, from: byName.get(name)?.value ?? '', to }));
  }, [drafts, configs]);

  const resetDrafts = () => {
    setDrafts({});
    setEditing(null);
  };

  const applyChanges = async () => {
    if (!onSave || readOnly) return;
    const payload: Record<string, string | null> = {};
    for (const change of changes) payload[change.name] = change.to === '' ? null : change.to;
    await onSave(payload);
    setConfirmOpen(false);
    resetDrafts();
  };

  if (error) return <ErrorState error={error} onRetry={onRetry} className={className} />;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter configs…"
          className="max-w-xs"
          aria-label="Filter configs"
        />
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Switch
            checked={showDefaults}
            onCheckedChange={setShowDefaults}
            aria-label="Show defaults"
          />
          Show defaults
        </label>
        {changes.length > 0 && onSave ? (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="warning">{changes.length} pending</Badge>
            <Button variant="outline" size="sm" onClick={resetDrafts}>
              <RotateCcw /> Discard
            </Button>
            <Tooltip content={readOnly ? readOnlyReason : undefined}>
              <span className="inline-flex">
                <Button size="sm" disabled={readOnly} onClick={() => setConfirmOpen(true)}>
                  Review &amp; apply
                </Button>
              </span>
            </Tooltip>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[38%]">Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-40">Source</TableHead>
              <TableHead className="w-24">Default</TableHead>
              {onSave ? <TableHead className="w-16" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell>
                    <Skeleton className="h-3.5 w-56" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-3.5 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-3.5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-3.5 w-12" />
                  </TableCell>
                  {onSave ? <TableCell /> : null}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={onSave ? 5 : 4}>
                  <EmptyState
                    compact
                    title="No configs match"
                    description={
                      showDefaults ? undefined : 'Enable “Show defaults” to see inherited values.'
                    }
                  />
                </td>
              </tr>
            ) : (
              rows.map((config) => {
                const sensitive = config.isSensitive || isSensitiveConfigName(config.name);
                const isRevealed = revealed[config.name];
                const draft = drafts[config.name];
                const isDirty = draft !== undefined && draft !== (config.value ?? '');
                const isEditing = editing === config.name;
                const displayValue = draft ?? config.value ?? '';

                return (
                  <TableRow
                    key={config.name}
                    className={cn(
                      isDirty && 'bg-[color-mix(in_srgb,var(--warning)_7%,transparent)]',
                    )}
                  >
                    <TableCell className="align-top">
                      <div className="flex items-start gap-1.5">
                        <span className="font-mono text-[13px] break-all">{config.name}</span>
                        {config.isReadOnly ? (
                          <Tooltip content="Read-only">
                            <Lock className="mt-0.5 size-3 shrink-0 text-[var(--muted)]" />
                          </Tooltip>
                        ) : null}
                      </div>
                      {config.documentation ? (
                        <p className="mt-0.5 line-clamp-2 text-2xs text-[var(--muted)]">
                          {config.documentation}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell className="align-top">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Input
                            mono
                            autoFocus
                            value={displayValue}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [config.name]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setEditing(null);
                              if (e.key === 'Escape') {
                                setDrafts((d) => {
                                  const next = { ...d };
                                  delete next[config.name];
                                  return next;
                                });
                                setEditing(null);
                              }
                            }}
                            aria-label={`Value for ${config.name}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditing(null)}
                            aria-label="Done"
                          >
                            <Check className="text-[var(--success)]" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="break-all font-mono text-[13px]">
                            {sensitive && !isRevealed
                              ? MASK
                              : displayValue || <span className="text-[var(--muted)]">—</span>}
                          </span>
                          {sensitive ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={isRevealed ? 'Hide value' : 'Reveal value'}
                              onClick={() =>
                                setRevealed((r) => ({ ...r, [config.name]: !r[config.name] }))
                              }
                            >
                              {isRevealed ? <EyeOff /> : <Eye />}
                            </Button>
                          ) : null}
                          {isDirty ? (
                            <Badge variant="warning" size="sm">
                              changed
                            </Badge>
                          ) : null}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      <span className="text-xs text-[var(--muted)]">{config.source}</span>
                    </TableCell>

                    <TableCell className="align-top">
                      {config.isDefault ? (
                        <Badge variant="secondary" size="sm">
                          default
                        </Badge>
                      ) : (
                        <Badge variant="info" size="sm">
                          overridden
                        </Badge>
                      )}
                    </TableCell>

                    {onSave ? (
                      <TableCell className="align-top text-right">
                        {config.isReadOnly ? null : isDirty ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Revert"
                            onClick={() => {
                              setDrafts((d) => {
                                const next = { ...d };
                                delete next[config.name];
                                return next;
                              });
                              setEditing(null);
                            }}
                          >
                            <X />
                          </Button>
                        ) : (
                          <Tooltip content={readOnly ? readOnlyReason : undefined}>
                            <span className="inline-flex">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${config.name}`}
                                disabled={readOnly}
                                onClick={() => {
                                  setDrafts((d) => ({ ...d, [config.name]: config.value ?? '' }));
                                  setEditing(config.name);
                                }}
                              >
                                <Pencil />
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Apply configuration changes</DialogTitle>
            <DialogDescription>
              {changes.length} config {changes.length === 1 ? 'entry' : 'entries'} will be altered.
              Review the diff before applying.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Config</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>New</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((change) => (
                    <TableRow key={change.name} className="hover:bg-transparent">
                      <TableCell className="font-mono text-[13px] break-all">
                        {change.name}
                      </TableCell>
                      <TableCell className="font-mono text-[13px] text-[var(--danger)] break-all line-through">
                        {change.from || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-[13px] text-[var(--success)] break-all">
                        {change.to || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} disabled={readOnly} onClick={() => void applyChanges()}>
              Apply {changes.length} {changes.length === 1 ? 'change' : 'changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
