import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Button } from './button';
import { SimpleSelect } from './select';

export interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  className?: string;
  label?: string;
}

export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  perPageOptions = [25, 50, 100, 200],
  className,
  label = 'rows',
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(perPage, 1)));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-1 py-2', className)}>
      <p className="text-xs text-[var(--muted)]">
        {total === 0 ? (
          `No ${label}`
        ) : (
          <>
            <span className="font-mono tabular-nums">{formatNumber(from)}</span>–
            <span className="font-mono tabular-nums">{formatNumber(to)}</span> of{' '}
            <span className="font-mono tabular-nums">{formatNumber(total)}</span> {label}
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        {onPerPageChange ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--muted)]">Rows</span>
            <SimpleSelect
              size="sm"
              className="w-[72px]"
              aria-label="Rows per page"
              value={String(perPage)}
              onValueChange={(v) => onPerPageChange(Number(v))}
              options={perPageOptions.map((n) => ({ label: String(n), value: String(n) }))}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="px-2 text-xs tabular-nums text-[var(--muted)]">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(pageCount)}
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
