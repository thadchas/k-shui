import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type RowData,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { Input } from './input';
import { Pagination } from './pagination';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

declare module '@tanstack/react-table' {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align + mono + tabular numerals. */
    numeric?: boolean;
    /** Human label used by the column-visibility menu. */
    label?: string;
    /** Fixed width utility class, e.g. 'w-24'. */
    widthClass?: string;
    /** Prevent the row-click handler from firing for this cell. */
    stopRowClick?: boolean;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

const VIRTUALIZE_THRESHOLD = 200;
const ROW_HEIGHT = 40;

export interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];

  /* state */
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /* toolbar */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  enableColumnVisibility?: boolean;
  hideToolbar?: boolean;

  /* sorting — controlled (server-side) or uncontrolled */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  manualSorting?: boolean;
  defaultSorting?: SortingState;

  /* server pagination */
  page?: number;
  perPage?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;

  /* interactions */
  onRowClick?: (row: TData) => void;
  rowActions?: (row: TData) => React.ReactNode;
  getRowId?: (row: TData, index: number) => string;
  isRowSelected?: (row: TData) => boolean;

  /* presentation */
  emptyState?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  containerClassName?: string;
  /** Max body height; enables virtualization scroll container. */
  maxHeight?: number | string;
  skeletonRows?: number;
  rowLabel?: string;
  /** Force virtualization on/off (defaults to rows > 200). */
  virtualize?: boolean;
  stickyHeader?: boolean;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  error,
  onRetry,
  globalFilter,
  onGlobalFilterChange,
  searchPlaceholder = 'Search…',
  toolbar,
  enableColumnVisibility = true,
  hideToolbar = false,
  sorting,
  onSortingChange,
  manualSorting = false,
  defaultSorting = [],
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  onRowClick,
  rowActions,
  getRowId,
  isRowSelected,
  emptyState,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  className,
  containerClassName,
  maxHeight,
  skeletonRows = 8,
  rowLabel = 'rows',
  virtualize,
  stickyHeader = true,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = React.useState<SortingState>(defaultSorting);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters] = React.useState<ColumnFiltersState>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const resolvedSorting = sorting ?? internalSorting;

  const allColumns = React.useMemo<ColumnDef<TData>[]>(() => {
    if (!rowActions) return columns;
    return [
      ...columns,
      {
        id: '__actions',
        header: () => null,
        enableSorting: false,
        enableHiding: false,
        meta: { widthClass: 'w-10', stopRowClick: true, label: 'Actions' },
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            {rowActions(row.original)}
          </div>
        ),
      },
    ];
  }, [columns, rowActions]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting: resolvedSorting,
      columnVisibility,
      columnFilters,
      globalFilter: onGlobalFilterChange ? undefined : globalFilter,
    },
    manualSorting,
    manualPagination: true,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(resolvedSorting) : updater;
      if (onSortingChange) onSortingChange(next);
      else setInternalSorting(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = virtualize ?? rows.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: shouldVirtualize,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    shouldVirtualize && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  const showPagination =
    page !== undefined && perPage !== undefined && total !== undefined && onPageChange;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== '__actions');

  const bodyStyle: React.CSSProperties = maxHeight
    ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }
    : shouldVirtualize
      ? { maxHeight: '65vh' }
      : {};

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {!hideToolbar && (onGlobalFilterChange || toolbar || enableColumnVisibility) ? (
        <div className="flex flex-wrap items-center gap-2">
          {onGlobalFilterChange ? (
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={globalFilter ?? ''}
                onChange={(e) => onGlobalFilterChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8 pr-8"
                aria-label={searchPlaceholder}
              />
              {globalFilter ? (
                <button
                  type="button"
                  onClick={() => onGlobalFilterChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted)] hover:text-[var(--foreground)]"
                  aria-label="Clear search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          {toolbar}
          {enableColumnVisibility && hideableColumns.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="md" className="ml-auto">
                  <Columns3 /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideableColumns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(Boolean(v))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {column.columnDef.meta?.label ?? column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          'overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]',
          containerClassName,
        )}
      >
        {error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : (
          <div ref={containerRef} className="relative overflow-auto" style={bodyStyle}>
            <table className="w-full border-collapse text-sm">
              <TableHeader sticky={stickyHeader}>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta;
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          numeric={meta?.numeric}
                          className={cn(meta?.widthClass)}
                          style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                'group inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-[var(--foreground)]',
                                meta?.numeric && 'flex-row-reverse',
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3 text-[var(--primary)]" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3 text-[var(--primary)]" />
                              ) : (
                                <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: skeletonRows }).map((_, i) => (
                    <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                      {table.getVisibleLeafColumns().map((column, j) => (
                        <TableCell key={column.id}>
                          <Skeleton
                            className={cn(
                              'h-3.5',
                              j === 0 ? 'w-40' : 'w-16',
                              column.columnDef.meta?.numeric && 'ml-auto',
                            )}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={table.getVisibleLeafColumns().length}>
                      {emptyState ?? (
                        <EmptyState title={emptyTitle} description={emptyDescription} />
                      )}
                    </td>
                  </tr>
                ) : (
                  <>
                    {paddingTop > 0 ? (
                      <tr style={{ height: paddingTop }}>
                        <td colSpan={table.getVisibleLeafColumns().length} />
                      </tr>
                    ) : null}
                    {(shouldVirtualize ? virtualItems.map((v) => rows[v.index]) : rows).map(
                      (row: Row<TData>) => (
                        <TableRow
                          key={row.id}
                          clickable={Boolean(onRowClick)}
                          selected={isRowSelected?.(row.original)}
                          style={shouldVirtualize ? { height: ROW_HEIGHT } : undefined}
                          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell
                              key={cell.id}
                              numeric={cell.column.columnDef.meta?.numeric}
                              className={cn(cell.column.columnDef.meta?.widthClass)}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ),
                    )}
                    {paddingBottom > 0 ? (
                      <tr style={{ height: paddingBottom }}>
                        <td colSpan={table.getVisibleLeafColumns().length} />
                      </tr>
                    ) : null}
                  </>
                )}
              </TableBody>
            </table>
          </div>
        )}
      </div>

      {showPagination ? (
        <Pagination
          page={page}
          perPage={perPage}
          total={total}
          onPageChange={onPageChange}
          onPerPageChange={onPerPageChange}
          label={rowLabel}
        />
      ) : null}
    </div>
  );
}

/** Reusable selection column for tables that need checkboxes. */
export function selectionColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: '__select',
    enableSorting: false,
    enableHiding: false,
    meta: { widthClass: 'w-9', stopRowClick: true },
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected()
            ? true
            : table.getIsSomePageRowsSelected()
              ? 'indeterminate'
              : false
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
        aria-label="Select row"
        onClick={(e) => e.stopPropagation()}
      />
    ),
  };
}

export { Table as RawTable };
export type { ColumnDef, SortingState };
