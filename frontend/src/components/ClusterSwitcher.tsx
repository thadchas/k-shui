import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronsUpDown, Boxes, Plus } from 'lucide-react';
import { useClusters } from '@/api/hooks/clusters';
import type { ClusterSummary } from '@/api/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot, statusTone } from '@/components/ui/status-pill';

export interface ClusterSwitcherProps {
  clusterId: string | null;
  collapsed?: boolean;
  className?: string;
}

export function ClusterSwitcher({ clusterId, collapsed, className }: ClusterSwitcherProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading } = useClusters();

  const current = useMemo<ClusterSummary | undefined>(
    () => data?.find((c) => c.id === clusterId),
    [data, clusterId],
  );

  if (isLoading && !data) {
    return <Skeleton className={cn('h-9 w-full', collapsed && 'size-9', className)} />;
  }

  const label = current?.name ?? (clusterId || 'Select cluster');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch cluster"
          className={cn(
            'h-9 w-full justify-between bg-[var(--surface-2)] font-medium',
            collapsed && 'w-9 justify-center px-0',
            className,
          )}
        >
          {collapsed ? (
            <Boxes className="size-4 text-[var(--primary)]" />
          ) : (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot
                  status={current?.status}
                  tone={current ? statusTone(current.status) : 'muted'}
                />
                <span className="truncate">{label}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--muted)]" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find cluster…" />
          <CommandList>
            <CommandEmpty>No clusters configured</CommandEmpty>
            <CommandGroup heading="Clusters">
              {(data ?? []).map((cluster) => (
                <CommandItem
                  key={cluster.id}
                  value={`${cluster.name} ${cluster.id}`}
                  onSelect={() => {
                    setOpen(false);
                    void navigate(`/c/${cluster.id}/overview`);
                  }}
                >
                  <StatusDot status={cluster.status} />
                  <span className="min-w-0 flex-1 truncate">{cluster.name}</span>
                  <span className="shrink-0 font-mono text-2xs text-[var(--muted)]">
                    {cluster.onlineBrokers}/{cluster.brokerCount}
                  </span>
                  {cluster.id === clusterId ? (
                    <Check className="size-3.5 text-[var(--primary)]!" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="all clusters"
                onSelect={() => {
                  setOpen(false);
                  void navigate('/clusters');
                }}
              >
                <Plus />
                All clusters
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
