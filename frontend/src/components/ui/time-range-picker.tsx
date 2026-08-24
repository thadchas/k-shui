import { Clock } from 'lucide-react';
import type { TimeRange } from '@/api/types';
import { cn } from '@/lib/utils';
import { SimpleSelect } from './select';

export const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: 'Last 15 minutes', value: '15m' },
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
];

export interface TimeRangePickerProps {
  value: TimeRange;
  onValueChange: (value: TimeRange) => void;
  className?: string;
  size?: 'sm' | 'md';
  ranges?: { label: string; value: TimeRange }[];
}

export function TimeRangePicker({
  value,
  onValueChange,
  className,
  size = 'md',
  ranges = TIME_RANGES,
}: TimeRangePickerProps) {
  return (
    <div className={cn('relative', className)}>
      <Clock className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
      <SimpleSelect
        aria-label="Time range"
        size={size}
        className="w-[168px] pl-7"
        value={value}
        onValueChange={(v) => onValueChange(v as TimeRange)}
        options={ranges}
      />
    </div>
  );
}

/** Datetime-local input used by the message browser's timestamp mode. */
export function DateTimeInput({
  value,
  onChange,
  className,
  ...props
}: {
  value: number | null;
  onChange: (ms: number | null) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const local = value
    ? new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 19)
    : '';
  return (
    <input
      type="datetime-local"
      step={1}
      value={local}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v ? new Date(v).getTime() : null);
      }}
      className={cn(
        'h-8 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2.5 font-mono text-[13px] text-[var(--foreground)]',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--primary)]',
        className,
      )}
      {...props}
    />
  );
}
