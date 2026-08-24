import type { LucideIcon } from 'lucide-react';
import { CHART_COLORS } from '@/lib/charts';
import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';
import { StatCard, type StatCardProps } from '@/components/ui/stat-card';
import type { SeriesPoint } from '@/api/types';

export interface StatTileProps extends Omit<StatCardProps, 'sparkline'> {
  points?: number[] | SeriesPoint[];
  sparklineColor?: string;
}

/**
 * StatCard with a built-in sparkline — the standard cluster/broker/topic KPI tile.
 */
export function StatTile({ points, sparklineColor = CHART_COLORS[0], ...props }: StatTileProps) {
  return (
    <StatCard
      {...props}
      sparkline={
        points && points.length > 1 ? (
          <Sparkline data={points} color={sparklineColor} height={32} />
        ) : undefined
      }
    />
  );
}

export function StatTileRow({
  className,
  columns = 4,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { columns?: 2 | 3 | 4 | 5 | 6 }) {
  const colClass: Record<number, string> = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5',
    6: 'sm:grid-cols-3 lg:grid-cols-6',
  };
  return <div className={cn('grid grid-cols-2 gap-3', colClass[columns], className)} {...props} />;
}

export type { LucideIcon };
