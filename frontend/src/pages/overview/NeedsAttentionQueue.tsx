import { Link } from 'react-router';
import { CheckCircle2, ListChecks, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardToolbarHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { AttentionItem, AttentionSourceId, AttentionSeverity } from './needsAttention';

const SEVERITY_BADGE: Record<
  AttentionSeverity,
  { variant: 'danger' | 'warning' | 'secondary'; label: string }
> = {
  critical: { variant: 'danger', label: 'critical' },
  warning: { variant: 'warning', label: 'warning' },
  unavailable: { variant: 'secondary', label: 'unavailable' },
};

export interface NeedsAttentionQueueProps {
  items: AttentionItem[];
  /** True while a source has not resolved yet and the queue has nothing cached to show. */
  loading: boolean;
  /** True once every source loaded and none of them produced an item. */
  healthy: boolean;
  onRetry: (source: AttentionSourceId) => void;
}

function AttentionRow({
  item,
  onRetry,
}: {
  item: AttentionItem;
  onRetry: (s: AttentionSourceId) => void;
}) {
  const badge = SEVERITY_BADGE[item.severity];
  const content = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Badge variant={badge.variant} size="sm" className="shrink-0">
        {badge.label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.resource}</p>
        <p className="truncate text-xs text-[var(--muted)]">{item.evidence}</p>
      </div>
    </div>
  );

  if (item.severity === 'unavailable' || !item.href) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        {content}
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onRetry(item.source)}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }

  return (
    <Link
      to={item.href}
      className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--surface-2)]"
    >
      {content}
    </Link>
  );
}

export function NeedsAttentionQueue({
  items,
  loading,
  healthy,
  onRetry,
}: NeedsAttentionQueueProps) {
  return (
    <Card>
      <CardToolbarHeader
        title="Needs attention"
        description="Offline or under-replicated partitions, failed services, then sustained consumer lag"
        actions={
          items.length > 0 ? (
            <Badge variant={items.some((i) => i.severity === 'critical') ? 'danger' : 'warning'}>
              {items.length}
            </Badge>
          ) : null
        }
      />
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : healthy ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="Nothing needs attention"
            description="Partitions, connectors, Flink jobs and consumer lag all checked out healthy."
          />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={ListChecks}
            title="No urgent items right now"
            description="Some telemetry sources may still be unavailable — see rows above once they load."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} onRetry={onRetry} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default NeedsAttentionQueue;
