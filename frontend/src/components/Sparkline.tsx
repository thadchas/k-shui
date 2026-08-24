import { useId, useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import type { SeriesPoint } from '@/api/types';
import { CHART_COLORS } from '@/lib/charts';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  /** Either raw numbers or `[ts, value]` tuples. */
  data: number[] | SeriesPoint[] | undefined;
  color?: string;
  height?: number;
  className?: string;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  color = CHART_COLORS[0],
  height = 32,
  className,
  strokeWidth = 1.5,
}: SparklineProps) {
  const gradientId = useId().replace(/:/g, '');
  const rows = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (Array.isArray(data[0])) {
      return (data as SeriesPoint[]).map(([ts, v]) => ({ x: ts, y: v }));
    }
    return (data as number[]).map((v, i) => ({ x: i, y: v }));
  }, [data]);

  if (rows.length < 2) {
    return (
      <div
        className={cn('flex items-center justify-center text-2xs text-[var(--muted)]', className)}
        style={{ height }}
      >
        —
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={strokeWidth}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
