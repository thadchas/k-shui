import * as React from 'react';
import { cn } from '@/lib/utils';

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn('relative w-full overflow-auto', containerClassName)}>
    <table
      ref={ref}
      className={cn('w-full caption-bottom border-collapse text-sm', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className, sticky = true, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(sticky && 'sticky top-0 z-10', 'bg-[var(--surface-2)]', className)}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <tbody ref={ref} className={cn('', className)} {...props} />);
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t border-[var(--border)] bg-[var(--surface-2)] font-medium', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & { clickable?: boolean; selected?: boolean }
>(({ className, clickable, selected, onClick, onKeyDown, ...props }, ref) => (
  <tr
    ref={ref}
    data-state={selected ? 'selected' : undefined}
    // Clickable rows are keyboard operable: focusable + Enter/Space trigger the click handler.
    tabIndex={clickable ? (props.tabIndex ?? 0) : props.tabIndex}
    role={clickable ? (props.role ?? 'button') : props.role}
    aria-selected={selected}
    onClick={onClick}
    onKeyDown={(e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || !clickable || !onClick) return;
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e as unknown as React.MouseEvent<HTMLTableRowElement>);
      }
    }}
    className={cn(
      'border-b border-[var(--border)] transition-colors',
      clickable &&
        'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]',
      'hover:bg-[var(--surface-2)] data-[state=selected]:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-9 whitespace-nowrap border-b border-[var(--border)] px-3 text-left align-middle text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]',
      numeric && 'text-right',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'h-10 px-3 align-middle text-sm text-[var(--foreground)]',
      numeric && 'text-right font-mono text-[13px] tabular-nums',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-[var(--muted)]', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';
