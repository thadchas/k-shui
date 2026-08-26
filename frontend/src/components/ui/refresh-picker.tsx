import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore, type RefreshIntervalMs } from '@/stores/ui';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Tooltip } from './tooltip';

export const REFRESH_OPTIONS: { label: string; value: RefreshIntervalMs }[] = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
  { label: '5m', value: 300000 },
];

export interface RefreshPickerProps {
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
}

/** Split control: manual refresh button + interval dropdown (persisted). */
export function RefreshPicker({ onRefresh, refreshing, className }: RefreshPickerProps) {
  const interval = useUiStore((s) => s.refreshInterval);
  const setInterval = useUiStore((s) => s.setRefreshInterval);
  const current = REFRESH_OPTIONS.find((o) => o.value === interval) ?? REFRESH_OPTIONS[0];

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[var(--radius-control)] border border-[var(--border)]',
        className,
      )}
    >
      <Tooltip content="Refresh now">
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-r-none"
          onClick={onRefresh}
          aria-label="Refresh now"
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </Button>
      </Tooltip>
      <span className="hidden h-4 w-px bg-[var(--border)] md:block" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="hidden rounded-l-none px-2 text-xs tabular-nums text-[var(--muted)] md:inline-flex"
            aria-label={`Auto refresh: ${current.label}`}
          >
            {current.label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Auto refresh</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={String(interval)}
            onValueChange={(v) => setInterval(Number(v) as RefreshIntervalMs)}
          >
            {REFRESH_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={String(o.value)}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
