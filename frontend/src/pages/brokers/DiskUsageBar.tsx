import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export const DISK_WARN_PCT = 75;
export const DISK_DANGER_PCT = 90;

/** Percent full from DescribeLogDirs capacity fields; null when either is unknown. */
export function diskPercent(
  totalBytes: number | null | undefined,
  usableBytes: number | null | undefined,
): number | null {
  if (
    totalBytes === null ||
    totalBytes === undefined ||
    usableBytes === null ||
    usableBytes === undefined ||
    totalBytes <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, ((totalBytes - usableBytes) / totalBytes) * 100));
}

export function diskTone(pct: number | null): 'success' | 'warning' | 'danger' | undefined {
  if (pct === null) return undefined;
  if (pct >= DISK_DANGER_PCT) return 'danger';
  if (pct >= DISK_WARN_PCT) return 'warning';
  return 'success';
}

export interface DiskUsageBarProps {
  totalBytes: number | null | undefined;
  usableBytes: number | null | undefined;
  /** Log size shown when capacity is unknown (older brokers / clients). */
  fallbackBytes: number | null | undefined;
  className?: string;
}

/**
 * "% full" bar (amber >= 75%, red >= 90%) when the broker reports capacity; otherwise the
 * plain log-dir size so the column never goes blank on clusters that predate DescribeLogDirs v4.
 */
export function DiskUsageBar({
  totalBytes,
  usableBytes,
  fallbackBytes,
  className,
}: DiskUsageBarProps) {
  const pct = diskPercent(totalBytes, usableBytes);
  if (pct === null) {
    return (
      <span
        className={cn('font-mono text-[13px] tabular-nums', className)}
        title="Disk capacity is not reported by this broker/client; showing log size"
      >
        {formatBytes(fallbackBytes)}
      </span>
    );
  }
  const tone = diskTone(pct);
  const used = (totalBytes ?? 0) - (usableBytes ?? 0);
  return (
    <div
      className={cn('flex items-center justify-end gap-2', className)}
      title={`${formatBytes(used)} used of ${formatBytes(totalBytes)} (${formatBytes(usableBytes)} free)`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="Disk usage"
    >
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'danger'
              ? 'bg-[var(--danger)]'
              : tone === 'warning'
                ? 'bg-[var(--warning)]'
                : 'bg-[var(--success)]',
          )}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span
        className={cn(
          'w-12 text-right font-mono text-[13px] tabular-nums',
          tone === 'danger' && 'text-[var(--danger)]',
          tone === 'warning' && 'text-[var(--warning)]',
        )}
      >
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
