import { useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, GitBranch } from 'lucide-react';
import type { LineageEdge, LineageNodeFull } from '@/api/types';
import { lineageTypeStyle } from '@/components/LineageGraph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dependencyRows, lineageNodeLink } from '../lineageLib';

export interface DependencyListProps {
  cluster: string;
  focusId: string;
  focusLabel: string;
  nodes: LineageNodeFull[];
  edges: LineageEdge[];
  depth: number;
  onFocus: (id: string) => void;
}

/**
 * Table alternative to the lineage canvas: the focused resource's upstream
 * and downstream dependencies as a flat, keyboard-navigable list. Renders no
 * canvas at all, so operators never need to pan/zoom to read it.
 */
export function DependencyList({
  cluster,
  focusId,
  focusLabel,
  nodes,
  edges,
  depth,
  onFocus,
}: DependencyListProps) {
  const rows = useMemo(
    () => dependencyRows(focusId, nodes, edges, depth),
    [focusId, nodes, edges, depth],
  );
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No dependencies at this depth"
        description={`${focusLabel} has no upstream or downstream nodes within ${depth} hop${depth === 1 ? '' : 's'}. Try increasing depth.`}
      />
    );
  }

  const moveFocus = (from: number, delta: number) => {
    rowRefs.current[from + delta]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
        Dependencies of <span className="font-medium text-[var(--foreground)]">{focusLabel}</span> —{' '}
        {rows.length} node{rows.length === 1 ? '' : 's'} within {depth} hop
        {depth === 1 ? '' : 's'}. Click a row, or press Enter, to refocus lineage on it.
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead numeric>Depth</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const style = lineageTypeStyle(row.type);
              const node = nodes.find((n) => n.id === row.id);
              const link = node ? lineageNodeLink(node, cluster) : null;
              return (
                <TableRow
                  key={row.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  clickable
                  onClick={() => onFocus(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      moveFocus(i, 1);
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      moveFocus(i, -1);
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      rowRefs.current[0]?.focus();
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      rowRefs.current[rows.length - 1]?.focus();
                    }
                  }}
                  aria-label={`${row.direction} · ${row.label} · ${style.label} · depth ${row.depth}`}
                >
                  <TableCell>
                    <Badge
                      variant={row.direction === 'upstream' ? 'outline' : 'secondary'}
                      size="sm"
                    >
                      {row.direction === 'upstream' ? (
                        <ArrowUpFromLine className="size-3" />
                      ) : (
                        <ArrowDownToLine className="size-3" />
                      )}
                      {row.direction}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium" title={row.id}>
                    {row.label}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs" style={{ color: style.color }}>
                      {style.label}
                    </span>
                  </TableCell>
                  <TableCell numeric>{row.depth}</TableCell>
                  <TableCell>
                    {link ? (
                      <Button
                        asChild
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Open ${row.label} detail page`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link to={link.to}>
                          <ArrowUpRight />
                        </Link>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
