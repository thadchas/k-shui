import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, MoreHorizontal, Package, Play, Trash2, Upload } from 'lucide-react';
import {
  useDeleteFlinkJar,
  useFlinkJarList,
  useRunFlinkJar,
  useUploadFlinkJar,
} from '@/api/hooks/flink';
import type { FlinkJar } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatTimestamp } from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { toast, toastError } from '@/components/ui/toast';

interface RunForm {
  entryClass: string;
  programArgs: string;
  parallelism: string;
  savepointPath: string;
  allowNonRestoredState: boolean;
}

const EMPTY_FORM: RunForm = {
  entryClass: '',
  programArgs: '',
  parallelism: '',
  savepointPath: '',
  allowNonRestoredState: false,
};

export function FlinkJarsPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const { fc = '' } = useParams<{ fc: string }>();
  const base = `/c/${cluster}/flink/${encodeURIComponent(fc)}`;

  const jars = useFlinkJarList(cluster, fc);
  const upload = useUploadFlinkJar(cluster, fc);
  const runJar = useRunFlinkJar(cluster, fc);
  const remove = useDeleteFlinkJar(cluster, fc);

  const fileRef = useRef<HTMLInputElement>(null);
  const [runTarget, setRunTarget] = useState<FlinkJar | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FlinkJar | null>(null);
  const [form, setForm] = useState<RunForm>(EMPTY_FORM);
  const [search, setSearch] = useState('');

  const columns = useMemo<ColumnDef<FlinkJar>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'JAR',
        meta: { label: 'JAR' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{row.original.name}</p>
            <p className="truncate font-mono text-2xs text-[var(--muted)]">{row.original.id}</p>
          </div>
        ),
      },
      {
        id: 'entries',
        header: 'Entry classes',
        meta: { label: 'Entry classes' },
        cell: ({ row }) =>
          (row.original.entry ?? []).length === 0 ? (
            <span className="text-2xs text-[var(--muted)]">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {(row.original.entry ?? []).slice(0, 3).map((e) => (
                <Badge key={e.name} variant="secondary" size="sm" title={e.description ?? ''}>
                  {e.name.split('.').pop()}
                </Badge>
              ))}
              {(row.original.entry ?? []).length > 3 ? (
                <Badge variant="outline" size="sm">
                  +{(row.original.entry ?? []).length - 3}
                </Badge>
              ) : null}
            </div>
          ),
      },
      {
        accessorKey: 'uploaded',
        header: 'Uploaded',
        meta: { label: 'Uploaded', widthClass: 'w-48' },
        cell: ({ row }) => (
          <span className="font-mono text-2xs tabular-nums text-[var(--muted)]">
            {formatTimestamp(row.original.uploaded)}
          </span>
        ),
      },
    ],
    [],
  );

  const openRun = (jar: FlinkJar) => {
    setForm({ ...EMPTY_FORM, entryClass: jar.entry?.[0]?.name ?? '' });
    setRunTarget(jar);
  };

  return (
    <div>
      <PageHeader
        title="JARs"
        description={`Uploaded program artifacts on ${fc}`}
        meta={jars.data ? <Badge variant="secondary">{jars.data.files.length}</Badge> : null}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to={base}>
                <ArrowLeft /> Cluster
              </Link>
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".jar"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                upload.mutate(file, {
                  onSuccess: () => toast.success(`Uploaded ${file.name}`),
                  onError: (err) => toastError('Upload failed', err),
                });
              }}
            />
            <Button loading={upload.isPending} onClick={() => fileRef.current?.click()}>
              <Upload /> Upload JAR
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={jars.data?.files ?? []}
        loading={jars.isLoading}
        error={jars.error}
        onRetry={() => void jars.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search JARs…"
        rowLabel="JARs"
        onRowClick={openRun}
        rowActions={(jar) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${jar.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => openRun(jar)}>
                <Play /> Run…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDeleteTarget(jar)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        emptyState={
          <EmptyState
            icon={Package}
            title={search ? 'No JARs match' : 'No JARs uploaded'}
            description={
              search
                ? 'Try a different search term.'
                : 'Upload a packaged Flink application to submit it to this session cluster.'
            }
            action={
              <Button onClick={() => fileRef.current?.click()}>
                <Upload /> Upload JAR
              </Button>
            }
          />
        }
      />

      <Dialog open={Boolean(runTarget)} onOpenChange={(open) => !open && setRunTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Run JAR</DialogTitle>
            <DialogDescription className="font-mono">{runTarget?.name}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="entry-class">Entry class</Label>
              {(runTarget?.entry ?? []).length > 0 ? (
                <SimpleSelect
                  value={form.entryClass}
                  onValueChange={(v) => setForm((f) => ({ ...f, entryClass: v }))}
                  options={(runTarget?.entry ?? []).map((e) => ({ label: e.name, value: e.name }))}
                  placeholder="Select entry class"
                  aria-label="Entry class"
                />
              ) : (
                <Input
                  id="entry-class"
                  value={form.entryClass}
                  onChange={(e) => setForm((f) => ({ ...f, entryClass: e.target.value }))}
                  placeholder="com.example.StreamingJob"
                  className="font-mono"
                />
              )}
              <p className="text-2xs text-[var(--muted)]">
                Leave empty to use the JAR manifest main class.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="program-args">Program arguments</Label>
              <Input
                id="program-args"
                value={form.programArgs}
                onChange={(e) => setForm((f) => ({ ...f, programArgs: e.target.value }))}
                placeholder="--input topic-a --output topic-b"
                className="font-mono"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="parallelism">Parallelism</Label>
                <Input
                  id="parallelism"
                  type="number"
                  min={1}
                  value={form.parallelism}
                  onChange={(e) => setForm((f) => ({ ...f, parallelism: e.target.value }))}
                  placeholder="cluster default"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="savepoint-path">Savepoint path</Label>
                <Input
                  id="savepoint-path"
                  value={form.savepointPath}
                  onChange={(e) => setForm((f) => ({ ...f, savepointPath: e.target.value }))}
                  placeholder="file:///savepoints/savepoint-abc"
                  className="font-mono"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5">
              <Checkbox
                checked={form.allowNonRestoredState}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, allowNonRestoredState: v === true }))
                }
              />
              <span className="text-xs text-[var(--foreground)]">
                Allow non-restored state (skip savepoint state with no matching operator)
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={runJar.isPending}
              onClick={() => {
                if (!runTarget) return;
                runJar.mutate(
                  {
                    jarId: runTarget.id,
                    entryClass: form.entryClass || null,
                    programArgs: form.programArgs || null,
                    parallelism: form.parallelism ? Number(form.parallelism) : null,
                    savepointPath: form.savepointPath || null,
                    allowNonRestoredState: form.allowNonRestoredState,
                  },
                  {
                    onSuccess: (res) => {
                      toast.success('Job submitted');
                      setRunTarget(null);
                      if (res?.jobid) void navigate(`${base}/jobs/${res.jobid}`);
                    },
                    onError: (e) => toastError('Submit failed', e),
                  },
                );
              }}
            >
              <Play /> Submit job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete JAR"
        description={
          <>
            Permanently removes <span className="font-mono">{deleteTarget?.name}</span> from the
            cluster. Running jobs are not affected.
          </>
        }
        confirmLabel="Delete JAR"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('JAR deleted');
              setDeleteTarget(null);
            },
            onError: (e) => toastError('Delete failed', e),
          });
        }}
      />
    </div>
  );
}

export default FlinkJarsPage;
