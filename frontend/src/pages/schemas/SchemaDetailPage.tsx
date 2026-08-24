import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  Download,
  FilePlus2,
  GitCompare,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  useCheckCompatibilityForSubject,
  useDeleteSchemaVersion,
  useDeleteSubject,
  useSchemaDiff,
  useSchemaSubject,
  useSubjectConfig,
  useUpdateSubjectConfig,
} from '@/api/hooks/schemas';
import type { Compatibility, SchemaVersion } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { formatTimestamp } from '@/lib/format';
import { downloadText } from '@/lib/utils';
import { CodeEditor } from '@/components/CodeEditor';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { DiffView } from '@/components/DiffView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, InlineError } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { CompatibilityResult } from './components/CompatibilityResult';
import {
  COMPATIBILITY_HELP,
  COMPATIBILITY_OPTIONS,
  SCHEMA_TYPE_VARIANT,
  editorLanguageForSchema,
  prettySchema,
  schemaFileExtension,
  topicFromSubject,
} from './components/schemaUtils';

const TABS = ['schema', 'versions', 'diff', 'compatibility'];

export function SchemaDetailPage() {
  const cluster = useClusterId();
  const { subject: subjectParam = '' } = useParams<{ subject: string }>();
  const subject = decodeURIComponent(subjectParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab') ?? 'schema';
  const tab = TABS.includes(requestedTab) ? requestedTab : 'schema';

  const detail = useSchemaSubject(cluster, subject);
  const config = useSubjectConfig(cluster, subject);
  const updateConfig = useUpdateSubjectConfig(cluster, subject);
  const deleteVersion = useDeleteSchemaVersion(cluster);
  const deleteSubject = useDeleteSubject(cluster);
  const check = useCheckCompatibilityForSubject(cluster);

  const versions = useMemo(
    () => [...(detail.data?.versions ?? [])].sort((a, b) => b.version - a.version),
    [detail.data?.versions],
  );
  const latest = versions[0];

  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);
  const [compatibility, setCompatibility] = useState<Compatibility | ''>('');
  const [candidate, setCandidate] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'version'; version: SchemaVersion } | { kind: 'subject'; permanent: boolean } | null
  >(null);

  useEffect(() => {
    if (selectedVersion === null && latest) setSelectedVersion(latest.version);
  }, [latest, selectedVersion]);

  useEffect(() => {
    if (versions.length >= 2 && diffFrom === null && diffTo === null) {
      setDiffFrom(versions[1].version);
      setDiffTo(versions[0].version);
    }
  }, [versions, diffFrom, diffTo]);

  useEffect(() => {
    const value = config.data?.compatibility ?? detail.data?.compatibility ?? null;
    if (value) setCompatibility(value);
  }, [config.data?.compatibility, detail.data?.compatibility]);

  const current = useMemo(
    () => versions.find((v) => v.version === selectedVersion) ?? latest,
    [versions, selectedVersion, latest],
  );

  useEffect(() => {
    if (!candidate && current?.schema)
      setCandidate(prettySchema(current.schema, current.schemaType));
  }, [candidate, current]);

  const diff = useSchemaDiff(
    cluster,
    subject,
    tab === 'diff' && diffFrom ? diffFrom : undefined,
    tab === 'diff' && diffTo ? diffTo : undefined,
  );

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const linkedTopic = topicFromSubject(subject);

  if (detail.error) {
    return (
      <div>
        <PageHeader title={<span className="font-mono">{subject}</span>} />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const versionOptions = versions.map((v) => ({
    label: `v${v.version}${v.version === latest?.version ? ' (latest)' : ''}`,
    value: String(v.version),
  }));

  const fromVersion = versions.find((v) => v.version === diffFrom);
  const toVersion = versions.find((v) => v.version === diffTo);

  const saveCompatibility = async () => {
    if (!compatibility) return;
    try {
      await updateConfig.mutateAsync(compatibility);
      toast.success(`Compatibility set to ${compatibility}`);
    } catch (e) {
      toastError('Failed to update compatibility', e);
    }
  };

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{subject}</span>}
        description={
          detail.data
            ? `${versions.length} version${versions.length === 1 ? '' : 's'} · latest v${latest?.version ?? '—'} · schema id ${latest?.id ?? '—'}`
            : undefined
        }
        meta={
          <span className="flex items-center gap-1.5">
            <CopyButton value={subject} tooltip="Copy subject" />
            {current ? (
              <Badge variant={SCHEMA_TYPE_VARIANT[current.schemaType] ?? 'secondary'}>
                {current.schemaType}
              </Badge>
            ) : null}
            {linkedTopic ? (
              <Link
                to={`/c/${cluster}/topics/${encodeURIComponent(linkedTopic)}`}
                className="font-mono text-2xs text-[var(--primary)] hover:underline"
              >
                {linkedTopic}
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/c/${cluster}/schemas`}>
                <ArrowLeft /> All schemas
              </Link>
            </Button>
            <Button asChild>
              <Link
                to={`/c/${cluster}/schemas/new?subject=${encodeURIComponent(subject)}&type=${current?.schemaType ?? 'AVRO'}`}
              >
                <FilePlus2 /> New version
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Subject actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={!current}
                  onSelect={() => {
                    if (!current) return;
                    downloadText(
                      prettySchema(current.schema, current.schemaType),
                      `${subject}-v${current.version}.${schemaFileExtension(current.schemaType)}`,
                      'text/plain',
                    );
                  }}
                >
                  <Download /> Download schema
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  disabled={!current || versions.length <= 1}
                  onSelect={() => current && setDeleteTarget({ kind: 'version', version: current })}
                >
                  <Trash2 /> Delete v{current?.version ?? ''}
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={() => setDeleteTarget({ kind: 'subject', permanent: false })}
                >
                  <Trash2 /> Soft delete subject
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={() => setDeleteTarget({ kind: 'subject', permanent: true })}
                >
                  <Trash2 /> Delete subject permanently
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Version</Label>
            <SimpleSelect
              value={selectedVersion !== null ? String(selectedVersion) : undefined}
              onValueChange={(v) => setSelectedVersion(Number(v))}
              options={versionOptions}
              placeholder="—"
              aria-label="Schema version"
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Compatibility</Label>
            <div className="flex items-center gap-1.5">
              <Tooltip
                content={compatibility ? COMPATIBILITY_HELP[compatibility] : 'Registry default'}
              >
                <span className="inline-block">
                  <SimpleSelect
                    value={compatibility || undefined}
                    onValueChange={(v) => setCompatibility(v as Compatibility)}
                    options={COMPATIBILITY_OPTIONS}
                    placeholder="inherited"
                    aria-label="Subject compatibility level"
                    className="w-52"
                  />
                </span>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                loading={updateConfig.isPending}
                disabled={
                  !compatibility ||
                  compatibility === (config.data?.compatibility ?? detail.data?.compatibility)
                }
                onClick={() => void saveCompatibility()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="compatibility">Compatibility</TabsTrigger>
        </TabsList>

        {/* -------------------------------- schema ------------------------------- */}
        <TabsContent value="schema" className="space-y-4">
          {detail.isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : !current ? (
            <Card>
              <EmptyState
                title="No versions"
                description="This subject has no readable versions."
              />
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              <Card className="min-w-0">
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <CardTitle>
                    v{current.version} · schema id {current.id}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <CopyButton
                      value={prettySchema(current.schema, current.schemaType)}
                      tooltip="Copy schema"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadText(
                          prettySchema(current.schema, current.schemaType),
                          `${subject}-v${current.version}.${schemaFileExtension(current.schemaType)}`,
                          'text/plain',
                        )
                      }
                    >
                      <Download /> Download
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <CodeEditor
                    value={prettySchema(current.schema, current.schemaType)}
                    language={editorLanguageForSchema(current.schemaType)}
                    readOnly
                    minimal={false}
                    height={520}
                    ariaLabel={`Schema ${subject} version ${current.version}`}
                  />
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <Detail label="Schema id" value={String(current.id)} mono />
                    <Detail label="Version" value={`v${current.version}`} mono />
                    <Detail label="Type" value={current.schemaType} />
                    <Detail
                      label="Registered"
                      value={current.createdAt ? formatTimestamp(current.createdAt) : '—'}
                    />
                    <Detail
                      label="Compatibility"
                      value={
                        config.data?.compatibility ?? detail.data?.compatibility ?? 'inherited'
                      }
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>References</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {current.references?.length ? (
                      <ul className="space-y-2">
                        {current.references.map((ref) => (
                          <li key={`${ref.name}-${ref.subject}-${ref.version}`} className="text-xs">
                            <p className="font-mono text-[var(--foreground)]">{ref.name}</p>
                            <Link
                              to={`/c/${cluster}/schemas/${encodeURIComponent(ref.subject)}`}
                              className="font-mono text-2xs text-[var(--primary)] hover:underline"
                            >
                              {ref.subject} v{ref.version}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-[var(--muted)]">No references.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ------------------------------- versions ------------------------------ */}
        <TabsContent value="versions">
          <Card>
            {detail.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : versions.length === 0 ? (
              <EmptyState title="No versions" description="Nothing registered for this subject." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Schema id</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>References</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.version}>
                      <TableCell className="font-mono">
                        v{version.version}
                        {version.version === latest?.version ? (
                          <Badge variant="secondary" size="sm" className="ml-2">
                            latest
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">{version.id}</TableCell>
                      <TableCell>
                        <Badge
                          variant={SCHEMA_TYPE_VARIANT[version.schemaType] ?? 'secondary'}
                          size="sm"
                        >
                          {version.schemaType}
                        </Badge>
                      </TableCell>
                      <TableCell>{version.references?.length ?? 0}</TableCell>
                      <TableCell className="text-[var(--muted)]">
                        {version.createdAt ? formatTimestamp(version.createdAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedVersion(version.version);
                              setTab('schema');
                            }}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete version ${version.version}`}
                            disabled={versions.length <= 1}
                            onClick={() => setDeleteTarget({ kind: 'version', version })}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* --------------------------------- diff -------------------------------- */}
        <TabsContent value="diff" className="space-y-4">
          <Card>
            <CardHeader className="flex-row flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>From</Label>
                <SimpleSelect
                  value={diffFrom !== null ? String(diffFrom) : undefined}
                  onValueChange={(v) => setDiffFrom(Number(v))}
                  options={versionOptions}
                  placeholder="—"
                  aria-label="Diff from version"
                  className="w-40"
                />
              </div>
              <GitCompare className="mb-2 size-4 text-[var(--muted)]" />
              <div className="space-y-1.5">
                <Label>To</Label>
                <SimpleSelect
                  value={diffTo !== null ? String(diffTo) : undefined}
                  onValueChange={(v) => setDiffTo(Number(v))}
                  options={versionOptions}
                  placeholder="—"
                  aria-label="Diff to version"
                  className="w-40"
                />
              </div>
            </CardHeader>
            <CardContent>
              {versions.length < 2 ? (
                <EmptyState
                  icon={GitCompare}
                  compact
                  title="Only one version"
                  description="Register another version to compare changes."
                />
              ) : diff.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <>
                  {diff.error ? (
                    <InlineError
                      className="mb-3"
                      error={diff.error}
                      onRetry={() => void diff.refetch()}
                    />
                  ) : null}
                  <DiffView
                    diff={diff.data?.unifiedDiff}
                    from={prettySchema(fromVersion?.schema, fromVersion?.schemaType)}
                    to={prettySchema(toVersion?.schema, toVersion?.schemaType)}
                    fromLabel={`v${diffFrom ?? ''}`}
                    toLabel={`v${diffTo ?? ''}`}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------- compatibility ---------------------------- */}
        <TabsContent value="compatibility" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Check a candidate schema</CardTitle>
              <p className="text-xs text-[var(--muted)]">
                Validates the schema below against the subject&apos;s compatibility level (
                <span className="font-mono">
                  {config.data?.compatibility ?? detail.data?.compatibility ?? 'inherited'}
                </span>
                ) without registering it.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeEditor
                value={candidate}
                onChange={setCandidate}
                language={editorLanguageForSchema(current?.schemaType)}
                height={360}
                minimal={false}
                ariaLabel="Candidate schema"
              />
              <div className="flex items-center gap-2">
                <Button
                  loading={check.isPending}
                  disabled={!candidate.trim()}
                  onClick={async () => {
                    try {
                      await check.mutateAsync({
                        subject,
                        schema: candidate,
                        schemaType: current?.schemaType ?? 'AVRO',
                      });
                    } catch (e) {
                      toastError('Compatibility check failed', e);
                    }
                  }}
                >
                  <ShieldCheck /> Check compatibility
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCandidate(prettySchema(current?.schema, current?.schemaType))}
                >
                  Reset to v{current?.version ?? ''}
                </Button>
              </div>
              <CompatibilityResult result={check.data} />
              {current ? (
                <details className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Current v{current.version} for reference
                  </summary>
                  <CodeBlock
                    className="mt-2"
                    code={prettySchema(current.schema, current.schemaType)}
                    maxHeight={280}
                  />
                </details>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDestructiveDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.kind === 'version'
            ? `Delete version ${deleteTarget.version.version}`
            : deleteTarget?.permanent
              ? 'Permanently delete subject'
              : 'Soft delete subject'
        }
        description={
          deleteTarget?.kind === 'version' ? (
            <>
              Removes v{deleteTarget.version.version} of{' '}
              <span className="font-mono">{subject}</span> from the registry.
            </>
          ) : deleteTarget?.permanent ? (
            <>
              Permanently removes <span className="font-mono">{subject}</span> and every version.
              Consumers resolving its schema ids will fail. This cannot be undone.
            </>
          ) : (
            <>
              Soft-deletes <span className="font-mono">{subject}</span>. It stays recoverable and
              remains visible under “Show deleted”.
            </>
          )
        }
        confirmText={
          deleteTarget?.kind === 'subject' && deleteTarget.permanent ? subject : undefined
        }
        confirmLabel={deleteTarget?.kind === 'version' ? 'Delete version' : 'Delete subject'}
        loading={deleteVersion.isPending || deleteSubject.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            if (deleteTarget.kind === 'version') {
              await deleteVersion.mutateAsync({
                subject,
                version: deleteTarget.version.version,
              });
              toast.success(`Deleted v${deleteTarget.version.version}`);
              setSelectedVersion(null);
              setDeleteTarget(null);
            } else {
              await deleteSubject.mutateAsync({
                subject,
                permanent: deleteTarget.permanent || undefined,
              });
              toast.success(`Subject ${subject} deleted`);
              setDeleteTarget(null);
              void navigate(`/c/${cluster}/schemas`);
            }
          } catch (e) {
            toastError('Delete failed', e);
          }
        }}
      />
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={mono ? 'truncate font-mono tabular-nums' : 'truncate'}>{value}</span>
    </div>
  );
}

export default SchemaDetailPage;
