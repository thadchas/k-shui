import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Compass, Maximize2, MoreHorizontal, Pencil, Trash2, MoveDown, MoveUp } from 'lucide-react';
import type { DashboardPanelSpec, SeriesResponse } from '@/api/types';
import { chartColor, seriesLabel } from '@/lib/charts';
import { formatUnit } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TimeSeriesChart } from '@/components/TimeSeriesChart';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { latestOf, panelGeometry, panelUnit, scaleSeries, thresholdColor } from '../panelUtils';

export interface PanelProps {
  panel: DashboardPanelSpec;
  data: SeriesResponse | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onFullscreen?: () => void;
  onExplore?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMove?: (direction: -1 | 1) => void;
  editable?: boolean;
  className?: string;
  heightOverride?: number;
}

function StatBody({
  value,
  unit,
  color,
  legend,
}: {
  value: number | null;
  unit: ReturnType<typeof panelUnit>;
  color: string | null;
  legend?: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center px-4 pb-3">
      <span
        className="truncate font-mono text-[26px] font-semibold leading-8 tabular-nums"
        style={{ color: color ?? 'var(--foreground)' }}
      >
        {value === null ? '—' : formatUnit(value, unit.unit)}
      </span>
      {legend ? <span className="truncate text-2xs text-[var(--muted)]">{legend}</span> : null}
    </div>
  );
}

function GaugeBody({
  value,
  unit,
  color,
  max,
}: {
  value: number | null;
  unit: ReturnType<typeof panelUnit>;
  color: string | null;
  max: number;
}) {
  const v = value ?? 0;
  const rows = [{ name: 'value', value: Math.min(v, max), fill: color ?? 'var(--primary)' }];
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={rows}
          startAngle={210}
          endAngle={-30}
          innerRadius="68%"
          outerRadius="100%"
          barSize={12}
        >
          <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
          <RadialBar background={{ fill: 'var(--surface-2)' }} dataKey="value" cornerRadius={6} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          className="font-mono text-lg font-semibold tabular-nums"
          style={{ color: color ?? 'var(--foreground)' }}
        >
          {value === null ? '—' : formatUnit(value, unit.unit)}
        </span>
      </div>
    </div>
  );
}

function HeatmapBody({
  series,
  unit,
}: {
  series: SeriesResponse['series'];
  unit: ReturnType<typeof panelUnit>;
}) {
  const rows = series.slice(0, 24);
  const all = rows.flatMap((s) => s.points.map((p) => p[1])).filter(Number.isFinite);
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;

  return (
    <div className="h-full overflow-auto px-4 pb-3">
      <div className="space-y-1">
        {rows.map((s, i) => {
          const buckets = s.points.slice(-60);
          return (
            <div key={`${s.name}-${i}`} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-2xs text-[var(--muted)]" title={s.name}>
                {seriesLabel(s.name)}
              </span>
              <div className="flex h-4 min-w-0 flex-1 gap-px">
                {buckets.map(([ts, v]) => {
                  const t = (v - min) / span;
                  return (
                    <Tooltip key={ts} content={`${formatUnit(v, unit.unit)}`}>
                      <span
                        className="min-w-0 flex-1 rounded-[2px]"
                        style={{
                          background: `color-mix(in srgb, ${chartColor(0)} ${Math.round(
                            10 + t * 90,
                          )}%, var(--surface-2))`,
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Panel({
  panel,
  data,
  loading,
  error,
  onRetry,
  onFullscreen,
  onExplore,
  onEdit,
  onDelete,
  onMove,
  editable,
  className,
  heightOverride,
}: PanelProps) {
  const unit = useMemo(() => panelUnit(panel.unit), [panel.unit]);
  const series = useMemo(() => scaleSeries(data?.series, unit.scale), [data, unit.scale]);
  const geometry = panelGeometry(panel);
  const height = heightOverride ?? geometry.h;

  const primary = series[0];
  const value = latestOf(primary);
  const color = thresholdColor(value, panel.thresholds);

  const barRows = useMemo(
    () =>
      series.map((s, i) => ({
        name: seriesLabel(s.name),
        value: latestOf(s) ?? 0,
        fill: chartColor(i),
      })),
    [series],
  );

  const hasMenu = Boolean(onFullscreen || onExplore || onEdit || onDelete || onMove);

  let body: React.ReactNode;
  if (loading) {
    body = <Skeleton className="mx-4 mb-4 h-[calc(100%-16px)]" />;
  } else if (error) {
    body = <InlineError error={error} onRetry={onRetry} className="mx-4 mb-4" />;
  } else if (series.length === 0) {
    body = (
      <div className="flex h-full items-center justify-center">
        <EmptyState compact title="No data" description="The query returned no series." />
      </div>
    );
  } else if (panel.type === 'stat') {
    body = (
      <StatBody
        value={value}
        unit={unit}
        color={color}
        legend={panel.queries?.[0]?.legend ?? primary?.name}
      />
    );
  } else if (panel.type === 'gauge') {
    const max =
      panel.thresholds && panel.thresholds.length > 0
        ? Math.max(...panel.thresholds.map((t) => t.value), value ?? 0) * 1.25 || 100
        : unit.unit === 'percent'
          ? 100
          : Math.max(1, (value ?? 0) * 1.5);
    body = <GaugeBody value={value} unit={unit} color={color} max={max} />;
  } else if (panel.type === 'bar') {
    body = (
      <div className="h-full px-2 pb-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={(v: number) => formatUnit(v, unit.unit)}
            />
            <RTooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v) => formatUnit(typeof v === 'number' ? v : Number(v), unit.unit)}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {barRows.map((r, i) => (
                <Cell key={r.name} fill={chartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  } else if (panel.type === 'table') {
    body = (
      <div className="h-full overflow-auto px-4 pb-3">
        <Table>
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead>Series</TableHead>
              <TableHead numeric>Last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((s, i) => (
              <TableRow key={`${s.name}-${i}`}>
                <TableCell className="truncate font-mono text-2xs">{s.name}</TableCell>
                <TableCell numeric>{formatUnit(latestOf(s), unit.unit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  } else if (panel.type === 'heatmap') {
    body = <HeatmapBody series={series} unit={unit} />;
  } else {
    body = (
      <div className="px-2 pb-2">
        <TimeSeriesChart series={series} unit={unit.unit} height={height - 52} area />
      </div>
    );
  }

  return (
    <Card
      className={cn('group flex min-w-0 flex-col overflow-hidden', className)}
      style={{ height }}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-3">
        <div className="min-w-0">
          <p
            className="truncate text-xs font-semibold text-[var(--foreground)]"
            title={panel.title}
          >
            {panel.title}
          </p>
          {panel.description ? (
            <p className="truncate text-2xs text-[var(--muted)]">{panel.description}</p>
          ) : null}
        </div>
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Panel menu for ${panel.title}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onFullscreen ? (
                <DropdownMenuItem onSelect={onFullscreen}>
                  <Maximize2 /> View fullscreen
                </DropdownMenuItem>
              ) : null}
              {onExplore ? (
                <DropdownMenuItem onSelect={onExplore}>
                  <Compass /> Explore query
                </DropdownMenuItem>
              ) : null}
              {editable && onEdit ? (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit panel
                </DropdownMenuItem>
              ) : null}
              {editable && onMove ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onMove(-1)}>
                    <MoveUp /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onMove(1)}>
                    <MoveDown /> Move down
                  </DropdownMenuItem>
                </>
              ) : null}
              {editable && onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={onDelete}>
                    <Trash2 /> Remove panel
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </Card>
  );
}
