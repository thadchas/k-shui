import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex min-w-0 items-center gap-1 text-xs', className)}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 ? <ChevronRight className="size-3 shrink-0 text-[var(--muted)]" /> : null}
            {item.to && !last ? (
              <Link
                to={item.to}
                className="truncate text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'truncate',
                  last ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]',
                )}
                aria-current={last ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
