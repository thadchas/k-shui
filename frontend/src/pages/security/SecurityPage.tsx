import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Plus, Shield, Trash2, Gauge } from 'lucide-react';
import {
  useAcls,
  useCreateAcl,
  useCreateScramUser,
  useDeleteAcl,
  useDeleteQuota,
  useDeleteScramUser,
  useQuotas,
  useScramUsers,
  useUpsertQuota,
} from '@/api/hooks/security';
import type {
  Acl,
  AclOperation,
  AclPatternType,
  AclPermissionType,
  AclResourceType,
  Quota,
  QuotaEntityType,
  ScramUser,
} from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { enumCodec, useSearchParamState, useUrlState } from '@/hooks/useUrlState';
import { formatBytes } from '@/lib/format';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

const RESOURCE_TYPES: AclResourceType[] = [
  'TOPIC',
  'GROUP',
  'CLUSTER',
  'TRANSACTIONAL_ID',
  'DELEGATION_TOKEN',
  'USER',
];
const PATTERN_TYPES: AclPatternType[] = ['LITERAL', 'PREFIXED'];
const OPERATIONS: AclOperation[] = [
  'ALL',
  'READ',
  'WRITE',
  'CREATE',
  'DELETE',
  'ALTER',
  'DESCRIBE',
  'CLUSTER_ACTION',
  'DESCRIBE_CONFIGS',
  'ALTER_CONFIGS',
  'IDEMPOTENT_WRITE',
];
const PERMISSIONS: AclPermissionType[] = ['ALLOW', 'DENY'];
const ENTITY_TYPES: QuotaEntityType[] = ['user', 'client-id', 'ip'];
const MECHANISMS = ['SCRAM-SHA-256', 'SCRAM-SHA-512'];

const EMPTY_ACL: Acl = {
  resourceType: 'TOPIC',
  resourceName: '*',
  patternType: 'LITERAL',
  principal: 'User:',
  host: '*',
  operation: 'READ',
  permissionType: 'ALLOW',
};

function AclsTab({ cluster }: { cluster: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<Acl>(EMPTY_ACL);
  const [deleteTarget, setDeleteTarget] = useState<Acl | null>(null);
  const [{ q: search }, setUrl] = useUrlState<{ q: string }>({ q: '' });
  const setSearch = (q: string) => setUrl({ q });
  const { canEdit } = usePermissions();

  const acls = useAcls(cluster);
  const createAcl = useCreateAcl(cluster);
  const deleteAcl = useDeleteAcl(cluster);

  const filtered = useMemo(() => {
    const list = acls.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) => a.principal.toLowerCase().includes(q) || a.resourceName.toLowerCase().includes(q),
    );
  }, [acls.data, search]);

  const columns = useMemo<ColumnDef<Acl>[]>(
    () => [
      {
        accessorKey: 'principal',
        header: 'Principal',
        meta: { label: 'Principal' },
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.principal}</span>,
      },
      {
        accessorKey: 'permissionType',
        header: 'Permission',
        meta: { label: 'Permission', widthClass: 'w-28' },
        cell: ({ row }) => (
          <Badge variant={row.original.permissionType === 'ALLOW' ? 'success' : 'danger'} size="sm">
            {row.original.permissionType}
          </Badge>
        ),
      },
      { accessorKey: 'operation', header: 'Operation', meta: { label: 'Operation' } },
      { accessorKey: 'resourceType', header: 'Resource type', meta: { label: 'Resource type' } },
      {
        accessorKey: 'resourceName',
        header: 'Resource',
        meta: { label: 'Resource' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">
            {row.original.resourceName}
            {row.original.patternType === 'PREFIXED' ? '*' : ''}
          </span>
        ),
      },
      {
        accessorKey: 'host',
        header: 'Host',
        meta: { label: 'Host' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.host}</span>,
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        loading={acls.isLoading}
        error={acls.error}
        onRetry={() => void acls.refetch()}
        globalFilter={search}
        onGlobalFilterChange={setSearch}
        searchPlaceholder="Search principals or resources…"
        rowLabel="ACLs"
        toolbar={
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                disabled={!canEdit}
                onClick={() => {
                  setDraft(EMPTY_ACL);
                  setCreateOpen(true);
                }}
              >
                <Plus /> New ACL
              </Button>
            </span>
          </Tooltip>
        }
        rowActions={(acl) => (
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete ACL"
                disabled={!canEdit}
                className="text-[var(--muted)] hover:text-[var(--danger)]"
                onClick={() => setDeleteTarget(acl)}
              >
                <Trash2 />
              </Button>
            </span>
          </Tooltip>
        )}
        emptyState={
          <EmptyState
            icon={Shield}
            title="No ACLs defined"
            description="Either the cluster has no authorizer configured, or no rules have been created."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New ACL
              </Button>
            }
          />
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create ACL</DialogTitle>
            <DialogDescription>Grant or deny an operation on a Kafka resource.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label required>Principal</Label>
              <Input
                mono
                value={draft.principal}
                onChange={(e) => setDraft({ ...draft, principal: e.target.value })}
                placeholder="User:alice"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Resource type</Label>
              <SimpleSelect
                value={draft.resourceType}
                onValueChange={(v) => setDraft({ ...draft, resourceType: v as AclResourceType })}
                options={RESOURCE_TYPES.map((t) => ({ label: t, value: t }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pattern type</Label>
              <SimpleSelect
                value={draft.patternType}
                onValueChange={(v) => setDraft({ ...draft, patternType: v as AclPatternType })}
                options={PATTERN_TYPES.map((t) => ({ label: t, value: t }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label required>Resource name</Label>
              <Input
                mono
                value={draft.resourceName}
                onChange={(e) => setDraft({ ...draft, resourceName: e.target.value })}
                placeholder="orders.* or *"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Operation</Label>
              <SimpleSelect
                value={draft.operation}
                onValueChange={(v) => setDraft({ ...draft, operation: v as AclOperation })}
                options={OPERATIONS.map((t) => ({ label: t, value: t }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Permission</Label>
              <SimpleSelect
                value={draft.permissionType}
                onValueChange={(v) =>
                  setDraft({ ...draft, permissionType: v as AclPermissionType })
                }
                options={PERMISSIONS.map((t) => ({ label: t, value: t }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Host</Label>
              <Input
                mono
                value={draft.host}
                onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createAcl.isPending}
              disabled={!draft.principal.trim() || !draft.resourceName.trim()}
              onClick={async () => {
                try {
                  await createAcl.mutateAsync(draft);
                  toast.success('ACL created');
                  setCreateOpen(false);
                } catch (e) {
                  toastError('Failed to create ACL', e);
                }
              }}
            >
              Create ACL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete ACL"
        description={
          <>
            Removes {deleteTarget?.permissionType} {deleteTarget?.operation} on{' '}
            <span className="font-mono">{deleteTarget?.resourceName}</span> for{' '}
            <span className="font-mono">{deleteTarget?.principal}</span>.
          </>
        }
        confirmText={deleteTarget?.principal}
        confirmLabel="Delete ACL"
        loading={deleteAcl.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteAcl.mutateAsync(deleteTarget);
            toast.success('ACL deleted');
            setDeleteTarget(null);
          } catch (e) {
            toastError('Failed to delete ACL', e);
          }
        }}
      />
    </>
  );
}

function QuotasTab({ cluster }: { cluster: string }) {
  const { canEdit } = usePermissions();
  const quotas = useQuotas(cluster);
  const upsert = useUpsertQuota(cluster);
  const remove = useDeleteQuota(cluster);
  const [editing, setEditing] = useState<Quota | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Quota | null>(null);

  const columns = useMemo<ColumnDef<Quota>[]>(
    () => [
      {
        accessorKey: 'entityType',
        header: 'Entity type',
        meta: { label: 'Entity type', widthClass: 'w-32' },
        cell: ({ row }) => (
          <Badge variant="secondary" size="sm">
            {row.original.entityType}
          </Badge>
        ),
      },
      {
        accessorKey: 'entityName',
        header: 'Entity',
        meta: { label: 'Entity' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px]">{row.original.entityName ?? '<default>'}</span>
        ),
      },
      {
        id: 'producer',
        header: 'Producer rate',
        meta: { numeric: true, label: 'Producer rate' },
        cell: ({ row }) =>
          row.original.quotas?.producer_byte_rate
            ? `${formatBytes(row.original.quotas.producer_byte_rate)}/s`
            : '—',
      },
      {
        id: 'consumer',
        header: 'Consumer rate',
        meta: { numeric: true, label: 'Consumer rate' },
        cell: ({ row }) =>
          row.original.quotas?.consumer_byte_rate
            ? `${formatBytes(row.original.quotas.consumer_byte_rate)}/s`
            : '—',
      },
      {
        id: 'request',
        header: 'Request %',
        meta: { numeric: true, label: 'Request %' },
        cell: ({ row }) => row.original.quotas?.request_percentage ?? '—',
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={quotas.data ?? []}
        loading={quotas.isLoading}
        error={quotas.error}
        onRetry={() => void quotas.refetch()}
        hideToolbar={false}
        enableColumnVisibility={false}
        rowLabel="quotas"
        toolbar={
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                disabled={!canEdit}
                onClick={() => setEditing({ entityType: 'client-id', entityName: '', quotas: {} })}
              >
                <Plus /> New quota
              </Button>
            </span>
          </Tooltip>
        }
        onRowClick={(quota) => setEditing(quota)}
        rowActions={(quota) => (
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete quota"
                disabled={!canEdit}
                className="text-[var(--muted)] hover:text-[var(--danger)]"
                onClick={() => setDeleteTarget(quota)}
              >
                <Trash2 />
              </Button>
            </span>
          </Tooltip>
        )}
        emptyState={
          <EmptyState
            icon={Gauge}
            title="No quotas configured"
            description="Throttle producers, consumers or IPs by adding a quota."
          />
        }
      />

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{editing?.entityName ? 'Edit quota' : 'New quota'}</DialogTitle>
            <DialogDescription>Leave a field empty to remove that limit.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Entity type</Label>
                <SimpleSelect
                  value={editing.entityType}
                  onValueChange={(v) =>
                    setEditing({ ...editing, entityType: v as QuotaEntityType })
                  }
                  options={ENTITY_TYPES.map((t) => ({ label: t, value: t }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Entity name</Label>
                <Input
                  mono
                  value={editing.entityName ?? ''}
                  onChange={(e) => setEditing({ ...editing, entityName: e.target.value })}
                  placeholder="<default>"
                />
              </div>
              <div className="space-y-1.5">
                <Label>producer_byte_rate</Label>
                <Input
                  mono
                  type="number"
                  value={editing.quotas?.producer_byte_rate ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      quotas: {
                        ...editing.quotas,
                        producer_byte_rate: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>consumer_byte_rate</Label>
                <Input
                  mono
                  type="number"
                  value={editing.quotas?.consumer_byte_rate ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      quotas: {
                        ...editing.quotas,
                        consumer_byte_rate: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>request_percentage</Label>
                <Input
                  mono
                  type="number"
                  value={editing.quotas?.request_percentage ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      quotas: {
                        ...editing.quotas,
                        request_percentage: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </div>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={upsert.isPending}
              onClick={async () => {
                if (!editing) return;
                try {
                  await upsert.mutateAsync(editing);
                  toast.success('Quota saved');
                  setEditing(null);
                } catch (e) {
                  toastError('Failed to save quota', e);
                }
              }}
            >
              Save quota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete quota"
        description={
          <>
            Removes the quota for{' '}
            <span className="font-mono">{deleteTarget?.entityName ?? '<default>'}</span>.
          </>
        }
        confirmText={deleteTarget?.entityName ?? 'default'}
        confirmLabel="Delete quota"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget);
            toast.success('Quota deleted');
            setDeleteTarget(null);
          } catch (e) {
            toastError('Failed to delete quota', e);
          }
        }}
      />
    </>
  );
}

function ScramTab({ cluster }: { cluster: string }) {
  const { canEdit } = usePermissions();
  const users = useScramUsers(cluster);
  const create = useCreateScramUser(cluster);
  const remove = useDeleteScramUser(cluster);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mechanism, setMechanism] = useState(MECHANISMS[1]);
  const [deleteTarget, setDeleteTarget] = useState<ScramUser | null>(null);

  const columns = useMemo<ColumnDef<ScramUser>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'User',
        meta: { label: 'User' },
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.name}</span>,
      },
      {
        id: 'mechanisms',
        header: 'Mechanisms',
        meta: { label: 'Mechanisms' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {(row.original.mechanisms ?? []).map((m) => (
              <Badge key={m.mechanism} variant="secondary" size="sm">
                {m.mechanism} ({m.iterations})
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={users.data ?? []}
        loading={users.isLoading}
        error={users.error}
        onRetry={() => void users.refetch()}
        enableColumnVisibility={false}
        rowLabel="users"
        toolbar={
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                disabled={!canEdit}
                onClick={() => {
                  setName('');
                  setPassword('');
                  setCreateOpen(true);
                }}
              >
                <Plus /> New SCRAM user
              </Button>
            </span>
          </Tooltip>
        }
        rowActions={(user) => (
          <Tooltip content={canEdit ? undefined : REQUIRES_EDITOR}>
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete user"
                disabled={!canEdit}
                className="text-[var(--muted)] hover:text-[var(--danger)]"
                onClick={() => setDeleteTarget(user)}
              >
                <Trash2 />
              </Button>
            </span>
          </Tooltip>
        )}
        emptyState={
          <EmptyState
            icon={KeyRound}
            title="No SCRAM users"
            description="SCRAM credentials are only available when the cluster uses SASL/SCRAM."
          />
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New SCRAM user</DialogTitle>
            <DialogDescription>
              Credentials are stored by the broker, never by k-shui.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Username</Label>
              <Input
                mono
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label required>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mechanism</Label>
              <SimpleSelect
                value={mechanism}
                onValueChange={setMechanism}
                options={MECHANISMS.map((m) => ({ label: m, value: m }))}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!name.trim() || !password}
              onClick={async () => {
                try {
                  await create.mutateAsync({ name: name.trim(), password, mechanism });
                  toast.success('SCRAM user created');
                  setCreateOpen(false);
                } catch (e) {
                  toastError('Failed to create user', e);
                }
              }}
            >
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete SCRAM user"
        description={
          <>
            Removes credentials for <span className="font-mono">{deleteTarget?.name}</span>.
          </>
        }
        confirmText={deleteTarget?.name}
        confirmLabel="Delete user"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync({ name: deleteTarget.name });
            toast.success('User deleted');
            setDeleteTarget(null);
          } catch (e) {
            toastError('Failed to delete user', e);
          }
        }}
      />
    </>
  );
}

const SECURITY_TABS = ['acls', 'quotas', 'scram'] as const;
type SecurityTab = (typeof SECURITY_TABS)[number];
const tabCodec = enumCodec<SecurityTab>(SECURITY_TABS, 'acls');

export function SecurityPage() {
  const cluster = useClusterId();
  const [tab, setTab] = useSearchParamState<SecurityTab>('tab', 'acls', tabCodec);

  return (
    <div>
      <PageHeader
        title="Security"
        description="Authorization rules, client quotas and SCRAM credentials."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(tabCodec.parse(v))}>
        <TabsList>
          <TabsTrigger value="acls">ACLs</TabsTrigger>
          <TabsTrigger value="quotas">Quotas</TabsTrigger>
          <TabsTrigger value="scram">SCRAM users</TabsTrigger>
        </TabsList>
        <TabsContent value="acls">
          <AclsTab cluster={cluster} />
        </TabsContent>
        <TabsContent value="quotas">
          <QuotasTab cluster={cluster} />
        </TabsContent>
        <TabsContent value="scram">
          <ScramTab cluster={cluster} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SecurityPage;
