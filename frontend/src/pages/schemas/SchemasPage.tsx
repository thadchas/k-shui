import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { FileJson, FilePlus2, Layers, MoreHorizontal, Trash2 } from 'lucide-react';
import { useDeleteSubject, useSchemaRegistryInfo, useSchemaSubjects } from '@/api/hooks/schemas';
import type { SchemaSubjectSummary } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { useDebounced } from '@/hooks/useDebounced';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { RegistryInfoCard } from './components/RegistryInfoCard';
import { SCHEMA_TYPE_VARIANT, topicFromSubject } from './components/schemaUtils';

type DeleteState =
  { kind: 'none' } | { kind: 'delete'; subject: SchemaSubjectSummary; permanent: boolean };

export function SchemasPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialog, setDialog] = useState<DeleteState>({ kind: 'none' });

  const query = useMemo(
    () => ({ search: debouncedSearch || undefined, deleted: showDeleted || undefined }),
    [debouncedSearch, showDeleted],
  );

  const info = useSchemaRegistryInfo(cluster);
  const subjects = useSchemaSubjects(cluster, query);
  const deleteSubject = useDeleteSubject(cluster);

  const closeDialog = () => setDialog({ kind: 'none' });

  const columns = useMemo<ColumnDef<SchemaSubjectSummary>[]>(
    () => [
      {
        accessorKey: 'subject',
        header: 'Subject',
        meta: { label: 'Subject' },
        cell: ({ row }) => (
          <span className="truncate font-mono text-[13px] font-medium">{row.original.subject}</span>
        ),
      },
      {
        accessorKey: 'schemaType',
        header: 'Type',
        meta: { label: 'Type', widthClass: 'w-28' },
        cell: ({ row }) => (
          <Badge variant={SCHEMA_TYPE_VARIANT[row.original.schemaType] ?? 'secondary'} size="sm">
            {row.original.schemaType}
          </Badge>
        ),
      },
      {
        accessorKey: 'latestVersion',
        header: 'Latest',
        meta: { numeric: true, label: 'Latest version', widthClass: 'w-20' },
        cell: ({ row }) => `v${row.original.latestVersion}`,
      },
      {
        accessorKey: 'versionsCount',
        header: 'Versions',
        meta: { numeric: true, label: 'Versions', widthClass: 'w-24' },
        cell: ({ row }) => row.original.versionsCount,
      },
      {
        accessorKey: 'compatibility',
        header: 'Compatibility',
        meta: { label: 'Compatibility', widthClass: 'w-44' },
        cell: ({ row }) =>
          row.original.compatibility ? (
            <Badge variant="outline" size="sm">
              {row.original.compatibility}
            </Badge>
          ) : (
            <Tooltip content="Inherits the registry default">
              <span className="text-2xs text-[var(--muted)]">inherited</span>
            </Tooltip>
          ),
      },
      {
        id: 'topic',
        header: 'Topic',
        meta: { label: 'Linked topic' },
        cell: ({ row }) => {
          const topic = row.original.topic ?? topicFromSubject(row.original.subject);
          if (!topic) return <span className="text-[var(--muted)]">—</span>;
          return (
            <Link
              to={`/c/${cluster}/topics/${encodeURIComponent(topic)}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate font-mono text-[13px] text-[var(--primary)] hover:underline"
            >
              {topic}
            </Link>
          );
        },
      },
    ],
    [cluster],
  );

  const rowActions = (subject: SchemaSubjectSummary) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${subject.subject}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onSelect={() =>
            void navigate(`/c/${cluster}/schemas/${encodeURIComponent(subject.subject)}`)
          }
        >
          <FileJson /> View schema
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void navigate(
              `/c/${cluster}/schemas/new?subject=${encodeURIComponent(subject.subject)}&type=${subject.schemaType}`,
            )
          }
        >
          <FilePlus2 /> New version
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => setDialog({ kind: 'delete', subject, permanent: false })}
        >
          <Trash2 /> Soft delete
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={() => setDialog({ kind: 'delete', subject, permanent: true })}
        >
          <Trash2 /> Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const active = dialog.kind === 'delete' ? dialog : null;

  return (
    <div>
      <PageHeader
        title="Schemas"
        description="Subjects, versions and compatibility in the schema registry."
        meta={subjects.data ? <Badge variant="secondary">{subjects.data.length}</Badge> : null}
        actions={
          <Button asChild>
            <Link to={`/c/${cluster}/schemas/new`}>
              <FilePlus2 /> Register schema
            </Link>
          </Button>
        }
      />

      <RegistryInfoCard
        cluster={cluster}
        info={info.data}
        loading={info.isLoading}
        error={info.error}
        onRetry={() => void info.refetch()}
      />

      <DataTable
        columns={columns}
        data={subjects.data ?? []}
        loading={subjects.isLoading}
        error={subjects.error}
        onRetry={() => void subjects.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search subjects…"
        defaultSorting={[{ id: 'subject', desc: false }]}
        onRowClick={(subject) =>
          void navigate(`/c/${cluster}/schemas/${encodeURIComponent(subject.subject)}`)
        }
        rowActions={rowActions}
        rowLabel="subjects"
        toolbar={
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--muted)]">
            <Switch
              checked={showDeleted}
              onCheckedChange={setShowDeleted}
              aria-label="Show soft-deleted subjects"
            />
            Show deleted
          </label>
        }
        emptyState={
          <EmptyState
            icon={Layers}
            title={search ? 'No subjects match your search' : 'No subjects registered'}
            description={
              search
                ? 'Try a different search term or enable “Show deleted”.'
                : 'Register a schema to start validating the data on your topics.'
            }
            action={
              !search ? (
                <Button asChild>
                  <Link to={`/c/${cluster}/schemas/new`}>
                    <FilePlus2 /> Register schema
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      />

      <ConfirmDestructiveDialog
        open={dialog.kind === 'delete'}
        onOpenChange={(open) => !open && closeDialog()}
        title={active?.permanent ? 'Permanently delete subject' : 'Soft delete subject'}
        description={
          active?.permanent ? (
            <>
              This removes <span className="font-mono">{active.subject.subject}</span> and all{' '}
              {active.subject.versionsCount} versions from the registry for good. Producers and
              consumers referencing its schema ids will fail. This cannot be undone.
            </>
          ) : (
            <>
              Soft-deletes <span className="font-mono">{active?.subject.subject}</span>. The subject
              stays recoverable and remains visible under “Show deleted”.
            </>
          )
        }
        confirmText={active?.permanent ? active.subject.subject : undefined}
        confirmLabel={active?.permanent ? 'Delete permanently' : 'Soft delete'}
        loading={deleteSubject.isPending}
        onConfirm={async () => {
          if (!active) return;
          try {
            await deleteSubject.mutateAsync({
              subject: active.subject.subject,
              permanent: active.permanent || undefined,
            });
            toast.success(`Subject ${active.subject.subject} deleted`);
            closeDialog();
          } catch (e) {
            toastError('Failed to delete subject', e);
          }
        }}
      />
    </div>
  );
}

export default SchemasPage;
