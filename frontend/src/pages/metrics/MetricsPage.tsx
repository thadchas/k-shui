import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  BarChart3,
  CircleAlert,
  Compass,
  Download,
  LayoutDashboard,
  MoreHorizontal,
  PlugZap,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  useCreateDashboard,
  useDashboardList,
  useDeleteDashboard,
  useImportDashboard,
  useMetricsStatusFull,
} from '@/api/hooks/metrics';
import type { DashboardSummaryFull } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { useSearchParamState } from '@/hooks/useUrlState';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CodeEditor } from '@/components';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

function StatusBanner({ cluster }: { cluster: string }) {
  const { data, isLoading, error, refetch } = useMetricsStatusFull(cluster);

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} compact />
      </Card>
    );
  }

  if (!data?.configured) {
    return (
      <Card className="flex items-start gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]">
          <PlugZap className="size-4 text-[var(--warning)]" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">Prometheus is not configured</p>
          <p className="text-2xs text-[var(--muted)]">
            Add a <span className="font-mono">prometheus.url</span> to this cluster in
            <span className="font-mono"> k-shui.yaml</span> to enable dashboards and the PromQL
            explorer.
          </p>
        </div>
      </Card>
    );
  }

  const targets = data.targets ?? [];
  const unhealthy = targets.filter((t) => t.health !== 'up');
  const byJob = new Map<string, { up: number; total: number }>();
  for (const t of targets) {
    const e = byJob.get(t.job) ?? { up: 0, total: 0 };
    e.total += 1;
    if (t.health === 'up') e.up += 1;
    byJob.set(t.job, e);
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            data.reachable
              ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)]'
              : 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]',
          )}
        >
          {data.reachable ? (
            <BarChart3 className="size-4 text-[var(--success)]" />
          ) : (
            <CircleAlert className="size-4 text-[var(--danger)]" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            {data.reachable ? 'Prometheus reachable' : 'Prometheus unreachable'}
          </p>
          <p className="truncate font-mono text-2xs text-[var(--muted)]">{data.url}</p>
        </div>
      </div>

      {data.buildInfo?.version ? (
        <Badge variant="secondary">v{data.buildInfo.version}</Badge>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {Array.from(byJob.entries()).map(([job, counts]) => (
          <Badge
            key={job}
            variant={
              counts.up === counts.total ? 'success' : counts.up === 0 ? 'danger' : 'warning'
            }
            title={`${counts.up}/${counts.total} targets up`}
          >
            {job} {counts.up}/{counts.total}
          </Badge>
        ))}
        {targets.length === 0 ? (
          <span className="text-2xs text-[var(--muted)]">No scrape targets reported</span>
        ) : null}
      </div>

      {unhealthy.length > 0 ? (
        <span className="text-2xs text-[var(--danger)]">
          {unhealthy.length} target{unhealthy.length === 1 ? '' : 's'} down
        </span>
      ) : targets[0]?.lastScrape ? (
        <span className="text-2xs text-[var(--muted)]">
          last scrape {formatRelative(targets[0].lastScrape)}
        </span>
      ) : null}
    </Card>
  );
}

function DashboardCard({
  cluster,
  item,
  onDelete,
  canEdit,
}: {
  cluster: string;
  item: DashboardSummaryFull;
  onDelete: (d: DashboardSummaryFull) => void;
  canEdit: boolean;
}) {
  return (
    <Card className="group flex flex-col gap-3 p-4 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/c/${cluster}/metrics/${encodeURIComponent(item.id)}`}
            className="block truncate text-sm font-semibold text-[var(--foreground)] hover:text-[var(--primary)]"
          >
            {item.title}
          </Link>
          {item.description ? (
            <p className="mt-0.5 line-clamp-2 text-2xs leading-4 text-[var(--muted)]">
              {item.description}
            </p>
          ) : null}
        </div>
        {item.builtin ? (
          <Badge variant="secondary" size="sm">
            built-in
          </Badge>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Actions for ${item.title}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                destructive
                disabled={!canEdit}
                title={canEdit ? undefined : REQUIRES_EDITOR}
                onSelect={() => onDelete(item)}
              >
                <Trash2 /> Delete dashboard
                {!canEdit ? (
                  <span className="ml-auto pl-3 text-2xs text-[var(--muted)]">
                    {REQUIRES_EDITOR}
                  </span>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {(item.tags ?? []).map((t) => (
          <Badge key={t} variant="outline" size="sm">
            {t}
          </Badge>
        ))}
        {item.panelCount ? (
          <span className="ml-auto text-2xs text-[var(--muted)]">{item.panelCount} panels</span>
        ) : null}
      </div>
    </Card>
  );
}

export function MetricsPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const dashboards = useDashboardList(cluster);
  const create = useCreateDashboard(cluster);
  const importDashboard = useImportDashboard(cluster);
  const remove = useDeleteDashboard(cluster);
  const { canEdit } = usePermissions();

  const [search, setSearch] = useSearchParamState<string>('q', '');
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [json, setJson] = useState('{\n  \n}');
  const [importId, setImportId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DashboardSummaryFull | null>(null);

  const { builtin, user } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (dashboards.data ?? []).filter(
      (d) =>
        !q ||
        d.title.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
    return {
      builtin: all.filter((d) => d.builtin),
      user: all.filter((d) => !d.builtin),
    };
  }, [dashboards.data, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Metrics"
        description="Prometheus-backed dashboards and ad-hoc PromQL."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={`/c/${cluster}/metrics/explore`}>
                <Compass /> Explore
              </Link>
            </Button>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setImportOpen(true)}
                >
                  <Download /> Import Grafana JSON
                </Button>
              </span>
            </Tooltip>
            <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
              <span className="inline-flex">
                <Button size="sm" disabled={!canEdit} onClick={() => setNewOpen(true)}>
                  <Plus /> New dashboard
                </Button>
              </span>
            </Tooltip>
          </>
        }
      />

      <StatusBanner cluster={cluster} />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search dashboards…"
          className="pl-8"
          data-table-search=""
          aria-label="Search dashboards"
        />
      </div>

      {dashboards.error ? (
        <Card>
          <ErrorState error={dashboards.error} onRetry={() => void dashboards.refetch()} />
        </Card>
      ) : dashboards.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : builtin.length === 0 && user.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutDashboard}
            title={search ? 'No dashboards match' : 'No dashboards'}
            description={
              search
                ? 'Try a different search term.'
                : 'Create a dashboard or import one from Grafana to get started.'
            }
            action={
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> New dashboard
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {user.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Your dashboards
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {user.map((d) => (
                  <DashboardCard
                    key={d.id}
                    cluster={cluster}
                    item={d}
                    onDelete={setDeleteTarget}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {builtin.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Built-in dashboards
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {builtin.map((d) => (
                  <DashboardCard
                    key={d.id}
                    cluster={cluster}
                    item={d}
                    onDelete={setDeleteTarget}
                    canEdit={canEdit}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>
              An empty dashboard you can fill with PromQL panels.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dash-title">Title</Label>
              <Input
                id="dash-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Producer throughput"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dash-desc">Description</Label>
              <Input
                id="dash-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!title.trim()}
              onClick={() =>
                create.mutate(
                  {
                    title: title.trim(),
                    description,
                    tags: [],
                    variables: [],
                    rows: [{ title: 'Row 1', panels: [] }],
                  },
                  {
                    onSuccess: (d) => {
                      toast.success('Dashboard created');
                      setNewOpen(false);
                      setTitle('');
                      setDescription('');
                      void navigate(`/c/${cluster}/metrics/${encodeURIComponent(d.id)}?edit=1`);
                    },
                    onError: (e) => toastError('Could not create dashboard', e),
                  },
                )
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import Grafana dashboard</DialogTitle>
            <DialogDescription>
              Paste a Grafana dashboard JSON export. Panels with Prometheus targets are converted.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-id">Dashboard id (optional)</Label>
              <Input
                id="import-id"
                value={importId}
                onChange={(e) => setImportId(e.target.value)}
                placeholder="auto from title"
                className="font-mono"
              />
            </div>
            <CodeEditor
              value={json}
              onChange={setJson}
              language="json"
              height={320}
              minimal={false}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={importDashboard.isPending}
              onClick={() => {
                let payload: Record<string, unknown>;
                try {
                  payload = JSON.parse(json) as Record<string, unknown>;
                } catch (e) {
                  toastError('Invalid JSON', e);
                  return;
                }
                importDashboard.mutate(
                  { payload, id: importId.trim() || undefined },
                  {
                    onSuccess: (d) => {
                      toast.success('Dashboard imported');
                      setImportOpen(false);
                      void navigate(`/c/${cluster}/metrics/${encodeURIComponent(d.id)}`);
                    },
                    onError: (e) => toastError('Import failed', e),
                  },
                );
              }}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete dashboard"
        description={
          <>
            Permanently removes <span className="font-mono">{deleteTarget?.title}</span>.
          </>
        }
        confirmText={deleteTarget?.id}
        confirmLabel="Delete dashboard"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('Dashboard deleted');
              setDeleteTarget(null);
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </div>
  );
}

export default MetricsPage;
