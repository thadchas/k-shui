import { useId, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipPayloadEntry } from 'recharts';
import type { Series } from '@/api/types';
import { chartColor, seriesLabel, seriesToRows } from '@/lib/charts';
import { formatAxis, formatTimeShort, formatTimestamp, formatUnit, type Unit } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';

export interface TimeSeriesChartProps {
  series: Series[] | undefined;
  unit?: Unit;
  height?: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
  /** Filled area under the line (12% opacity gradient). */
  area?: boolean;
  showLegend?: boolean;
  emptyMessage?: string;
  /** Override the auto-derived legend labels. */
  labels?: Record<string, string>;
  colorOffset?: number;
  stacked?: boolean;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  labels,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry>;
  label?: number | string;
  unit: Unit;
  labels?: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 font-mono text-2xs text-[var(--muted)]">
        {formatTimestamp(Number(label))}
      </p>
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '');
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="size-2 shrink-0 rounded-full" style={{ background: item.color }} />
              <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
                {labels?.[key] ?? seriesLabel(key)}
              </span>
              <span className="font-mono tabular-nums text-[var(--foreground)]">
                {formatUnit(typeof item.value === 'number' ? item.value : Number(item.value), unit)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeSeriesChart({
  series,
  unit = 'count',
  height = 220,
  loading,
  error,
  onRetry,
  className,
  area = true,
  showLegend = true,
  emptyMessage = 'No data for this time range',
  labels,
  colorOffset = 0,
  stacked = false,
}: TimeSeriesChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const rows = useMemo(() => seriesToRows(series), [series]);
  const names = useMemo(() => (series ?? []).map((s) => s.name), [series]);

  if (loading) {
    return <Skeleton className={cn('w-full', className)} style={{ height }} />;
  }
  if (error) {
    return <InlineError error={error} onRetry={onRetry} className={className} />;
  }
  if (rows.length === 0 || names.length === 0) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height }}>
        <EmptyState compact title="No data" description={emptyMessage} />
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {names.map((name, i) => (
              <linearGradient key={name} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor(i + colorOffset)} stopOpacity={0.12} />
                <stop offset="100%" stopColor={chartColor(i + colorOffset)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={(v: number) => formatTimeShort(v)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(v: number) => formatAxis(v, unit)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <RTooltip
            content={<ChartTooltip unit={unit} labels={labels} />}
            cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
          />
          {showLegend && names.length > 1 ? (
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="plainline"
              iconSize={10}
              // recharts v3 sorts legend items alphabetically by default; v2 kept the
              // order the series were declared in. `null` restores the v2 behaviour so
              // the legend colours line up with the chart series order.
              itemSorter={null}
              formatter={(value: unknown) => {
                const key = String(value ?? '');
                return (
                  <span className="text-xs text-[var(--muted)]">
                    {labels?.[key] ?? seriesLabel(key)}
                  </span>
                );
              }}
            />
          ) : null}
          {names.map((name, i) =>
            area ? (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stroke={chartColor(i + colorOffset)}
                strokeWidth={1.5}
                fill={`url(#${gradientId}-${i})`}
                fillOpacity={1}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
                stackId={stacked ? 'a' : undefined}
              />
            ) : (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={chartColor(i + colorOffset)}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
