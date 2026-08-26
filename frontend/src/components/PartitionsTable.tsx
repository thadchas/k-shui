import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Crown, Gauge, Shuffle, Vote } from 'lucide-react';
import { useClearThrottle, useReassignments } from '@/api/hooks/partitions';
import type { PartitionDetail, PartitionRef, ReassignmentInProgress } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { REQUIRES_EDITOR, usePermissions } from '@/hooks/usePermissions';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConfirmDestructiveDialog } from '@/components/ConfirmDestructiveDialog';
import { ElectLeadersDialog } from '@/components/PartitionOps/ElectLeadersDialog';
import { ReassignDialog } from '@/components/PartitionOps/ReassignDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';

function ReplicaList({
  ids,
  isr,
  leader,
  reassignment,
}: {
  ids: number[];
  isr: number[];
  leader: number | null;
  reassignment?: ReassignmentInProgress;
}) {
  const isrSet = new Set(isr);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id, index) => {
        const inSync = isrSet.has(id);
        const preferred = index === 0;
        const isLeader = id === leader;
        const tip = [
          inSync ? 'In sync' : 'Out of sync',
          preferred ? 'preferred leader' : null,
          isLeader ? 'current leader' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Tooltip key={id} content={tip}>
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded px-1 font-mono text-2xs tabular-nums',
                inSync
                  ? 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]'
                  : 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]',
                isLeader && 'ring-1 ring-current',
              )}
            >
              {preferred ? <Crown className="size-2.5" aria-label="Preferred leader" /> : null}
              {id}
            </span>
          </Tooltip>
        );
      })}
      {reassignment?.addingReplicas.length ? (
        <Tooltip
          content={`Reassignment in progress: adding broker(s) ${reassignment.addingReplicas.join(', ')}`}
        >
          <Badge variant="info" size="sm">
            +{reassignment.addingReplicas.join(',')}
          </Badge>
        </Tooltip>
      ) : null}
      {reassignment?.removingReplicas.length ? (
        <Tooltip
          content={`Reassignment in progress: removing broker(s) ${reassignment.removingReplicas.join(', ')}`}
        >
          <Badge variant="warning" size="sm">
            −{reassignment.removingReplicas.join(',')}
          </Badge>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function isPartitionUnhealthy(p: PartitionDetail): boolean {
  return p.leader === null || p.isr.length < p.replicas.length;
}

export function hasNonPreferredLeader(p: PartitionDetail): boolean {
  return p.leader !== null && p.replicas.length > 0 && p.leader !== p.replicas[0];
}

export interface PartitionsTableProps {
  partitions: PartitionDetail[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  onRowClick?: (partition: PartitionDetail) => void;
  /** Topic the partitions belong to; enables the election / reassignment actions. */
  topic?: string;
  /** Defaults to the `:cluster` route param. */
  clusterId?: string;
}

export function PartitionsTable({
  partitions,
  loading,
  error,
  onRetry,
  className,
  onRowClick,
  topic: topicProp,
  clusterId: clusterProp,
}: PartitionsTableProps) {
  const routeCluster = useClusterId();
  const clusterId = clusterProp ?? routeCluster;
  // TopicDetailPage renders us under /c/:cluster/topics/:topic — fall back to the route param
  // when the topic prop is not passed so the actions stay available without a page change.
  const { topic: routeTopic = '' } = useParams<{ topic: string }>();
  const topic = topicProp ?? routeTopic;
  const actionsEnabled = Boolean(clusterId && topic);

  const { canEdit } = usePermissions();
  const reassignments = useReassignments(clusterId, actionsEnabled);
  const inFlight = useMemo(() => {
    const map = new Map<number, ReassignmentInProgress>();
    for (const r of reassignments.data?.items ?? []) if (r.topic === topic) map.set(r.partition, r);
    return map;
  }, [reassignments.data, topic]);

  const [onlyUnhealthy, setOnlyUnhealthy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [electOpen, setElectOpen] = useState(false);
  const [throttleOpen, setThrottleOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<PartitionDetail | null>(null);
  const clearThrottle = useClearThrottle(clusterId ?? '');
  const throttled = reassignments.data?.throttled ?? false;

  // Drop selections for partitions that disappeared (e.g. topic switched).
  useEffect(() => {
    const ids = new Set((partitions ?? []).map((p) => p.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [partitions]);

  const totalMessages = useMemo(
    () => (partitions ?? []).reduce((acc, p) => acc + Math.max(0, p.endOffset - p.beginOffset), 0),
    [partitions],
  );
  const unhealthyCount = useMemo(
    () => (partitions ?? []).filter(isPartitionUnhealthy).length,
    [partitions],
  );

  const rows = useMemo(
    () => (onlyUnhealthy ? (partitions ?? []).filter(isPartitionUnhealthy) : (partitions ?? [])),
    [partitions, onlyUnhealthy],
  );

  const selectedRows = useMemo(
    () => (partitions ?? []).filter((p) => selected.has(p.id)),
    [partitions, selected],
  );
  const electable = useMemo(() => selectedRows.filter(hasNonPreferredLeader), [selectedRows]);
  const electTargets: PartitionRef[] = useMemo(
    () => electable.map((p) => ({ topic, partition: p.id })),
    [electable, topic],
  );

  const allVisibleSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const someVisibleSelected = rows.some((p) => selected.has(p.id));
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of rows) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  const toggleOne = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns = useMemo<ColumnDef<PartitionDetail>[]>(() => {
    const base: ColumnDef<PartitionDetail>[] = [
      {
        accessorKey: 'id',
        header: 'Partition',
        meta: { numeric: true, label: 'Partition', widthClass: 'w-24' },
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.id}</span>,
      },
      {
        accessorKey: 'leader',
        header: 'Leader',
        meta: { numeric: true, label: 'Leader', widthClass: 'w-36' },
        cell: ({ row }) => {
          const { leader, replicas } = row.original;
          if (leader === null) {
            return (
              <Badge variant="danger" size="sm">
                none
              </Badge>
            );
          }
          const preferred = replicas[0];
          const notPreferred = preferred !== undefined && leader !== preferred;
          return (
            <span className="inline-flex items-center justify-end gap-1.5">
              <span className="font-mono tabular-nums">{leader}</span>
              {notPreferred ? (
                <Tooltip
                  content={`Preferred leader is broker ${preferred}. Select the row and run "Elect preferred leader" to move it back.`}
                >
                  <Badge variant="warning" size="sm">
                    not preferred
                  </Badge>
                </Tooltip>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'replicas',
        header: 'Replicas',
        meta: { label: 'Replicas' },
        cell: ({ row }) => (
          <ReplicaList
            ids={row.original.replicas}
            isr={row.original.isr}
            leader={row.original.leader}
            reassignment={inFlight.get(row.original.id)}
          />
        ),
      },
      {
        id: 'isr',
        header: 'ISR',
        meta: { numeric: true, label: 'ISR' },
        cell: ({ row }) => {
          const under = row.original.isr.length < row.original.replicas.length;
          return (
            <span className={cn('font-mono tabular-nums', under && 'text-[var(--warning)]')}>
              {row.original.isr.length}/{row.original.replicas.length}
            </span>
          );
        },
      },
      {
        accessorKey: 'beginOffset',
        header: 'Begin offset',
        meta: { numeric: true, label: 'Begin offset' },
        cell: ({ row }) => formatNumber(row.original.beginOffset),
      },
      {
        accessorKey: 'endOffset',
        header: 'End offset',
        meta: { numeric: true, label: 'End offset' },
        cell: ({ row }) => formatNumber(row.original.endOffset),
      },
      {
        id: 'messages',
        header: 'Messages',
        meta: { numeric: true, label: 'Messages', widthClass: 'w-44' },
        accessorFn: (row) => row.endOffset - row.beginOffset,
        cell: ({ row }) => {
          const count = Math.max(0, row.original.endOffset - row.original.beginOffset);
          const pct = totalMessages > 0 ? (count / totalMessages) * 100 : 0;
          return (
            <span className="inline-flex items-center justify-end gap-2">
              <span className="font-mono tabular-nums">{formatNumber(count)}</span>
              <Tooltip content={`${pct.toFixed(1)}% of topic`}>
                <span
                  className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]"
                  role="img"
                  aria-label={`${pct.toFixed(1)} percent of topic`}
                >
                  <span
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%` }}
                  />
                </span>
              </Tooltip>
              <span className="w-10 text-right font-mono text-2xs tabular-nums text-[var(--muted)]">
                {pct.toFixed(pct < 10 ? 1 : 0)}%
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: 'sizeBytes',
        header: 'Size',
        meta: { numeric: true, label: 'Size' },
        cell: ({ row }) => formatBytes(row.original.sizeBytes),
      },
    ];
    if (!actionsEnabled) return base;
    const select: ColumnDef<PartitionDetail> = {
      id: '__select',
      enableSorting: false,
      enableHiding: false,
      meta: { widthClass: 'w-9', stopRowClick: true },
      header: () => (
        <Checkbox
          checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
          onCheckedChange={(v) => toggleAll(v === true)}
          aria-label="Select all partitions"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selected.has(row.original.id)}
          onCheckedChange={(v) => toggleOne(row.original.id, v === true)}
          aria-label={`Select partition ${row.original.id}`}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    };
    return [select, ...base];
    // toggleAll/toggleOne are stable closures over setState; rows/selected drive the header state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMessages, inFlight, actionsEnabled, allVisibleSelected, someVisibleSelected, selected]);

  const electDisabledReason = !canEdit
    ? REQUIRES_EDITOR
    : selectedRows.length === 0
      ? 'Select one or more partitions'
      : electable.length === 0
        ? 'Every selected partition is already led by its preferred replica'
        : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {actionsEnabled ? (
          <>
            {selectedRows.length > 0 ? (
              <span className="text-xs text-[var(--muted)]">
                {selectedRows.length} selected
                {electable.length > 0 ? ` · ${electable.length} not on preferred leader` : ''}
              </span>
            ) : null}
            <Tooltip content={electDisabledReason}>
              <span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(electDisabledReason)}
                  onClick={() => setElectOpen(true)}
                >
                  <Vote /> Elect preferred leader
                </Button>
              </span>
            </Tooltip>
            {reassignments.data?.items.some((r) => r.topic === topic) ? (
              <Badge variant="info" size="sm">
                {inFlight.size} reassigning
              </Badge>
            ) : null}
            {throttled ? (
              <Tooltip
                content={
                  canEdit
                    ? 'A replication throttle from a reassignment is still configured on the brokers'
                    : REQUIRES_EDITOR
                }
              >
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit}
                    onClick={() => setThrottleOpen(true)}
                  >
                    <Gauge /> Clear throttle
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </>
        ) : null}
        {unhealthyCount > 0 ? (
          <Badge variant="warning" size="sm">
            {unhealthyCount} unhealthy
          </Badge>
        ) : null}
        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--muted)]">
          <Switch
            checked={onlyUnhealthy}
            onCheckedChange={setOnlyUnhealthy}
            aria-label="Only show unhealthy partitions"
          />
          Only unhealthy
        </label>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        hideToolbar
        defaultSorting={[{ id: 'id', desc: false }]}
        onRowClick={onRowClick}
        getRowId={(row) => String(row.id)}
        isRowSelected={actionsEnabled ? (row) => selected.has(row.id) : undefined}
        rowActions={
          actionsEnabled
            ? (row) => (
                <Tooltip content={canEdit ? 'Reassign replicas…' : REQUIRES_EDITOR}>
                  <span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reassign replicas of partition ${row.id}`}
                      disabled={!canEdit}
                      onClick={() => setReassignTarget(row)}
                    >
                      <Shuffle />
                    </Button>
                  </span>
                </Tooltip>
              )
            : undefined
        }
        emptyTitle={onlyUnhealthy ? 'All partitions healthy' : 'No partitions'}
        emptyDescription={
          onlyUnhealthy ? 'Every partition has a leader and a full in-sync set.' : undefined
        }
        rowLabel="partitions"
      />
      {actionsEnabled ? (
        <>
          <ConfirmDestructiveDialog
            open={throttleOpen}
            onOpenChange={setThrottleOpen}
            title="Clear replication throttle?"
            description="Removes leader/follower.replication.throttled.rate from every broker and the throttled-replica lists from every topic that carries them. Only do this once no reassignment is in flight, otherwise the move runs unthrottled."
            confirmLabel="Clear throttle"
            loading={clearThrottle.isPending}
            onConfirm={async () => {
              try {
                const result = await clearThrottle.mutateAsync({});
                toast.success('Throttle cleared', {
                  description: `${result.brokers.length} broker(s), ${result.topics.length} topic(s)`,
                });
                setThrottleOpen(false);
              } catch (e) {
                toastError('Could not clear throttle', e);
              }
            }}
          />
          <ElectLeadersDialog
            open={electOpen}
            onOpenChange={setElectOpen}
            clusterId={clusterId}
            partitions={electTargets}
            onDone={() => setSelected(new Set())}
          />
          <ReassignDialog
            open={reassignTarget !== null}
            onOpenChange={(open) => {
              if (!open) setReassignTarget(null);
            }}
            clusterId={clusterId}
            topic={topic}
            partition={reassignTarget}
          />
        </>
      ) : null}
    </div>
  );
}
