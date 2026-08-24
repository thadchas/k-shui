import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-16',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
        <Icon className="size-5 text-[var(--primary)]" />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-base font-semibold text-[var(--foreground)]">{title}</p>
        {description ? (
          <p className="text-xs leading-5 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
