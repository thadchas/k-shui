import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/ui/copy-button';

/**
 * Unified-diff renderer. Accepts a server-produced unified diff (Schema
 * Registry `/diff`) or two texts, in which case the diff is computed locally so
 * the view still works when the endpoint is unavailable.
 */

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

/** Longest-common-subsequence diff — inputs here are single schema documents. */
export function computeUnifiedDiff(from: string, to: string): DiffLine[] {
  const a = from.replace(/\r\n/g, '\n').split('\n');
  const b = to.replace(/\r\n/g, '\n').split('\n');
  const n = a.length;
  const m = b.length;

  /* Guard against pathological inputs — fall back to a whole-file replace. */
  if (n * m > 4_000_000) {
    return [
      ...a.map((text, i) => ({
        kind: 'remove' as const,
        text,
        oldNumber: i + 1,
        newNumber: null,
      })),
      ...b.map((text, i) => ({ kind: 'add' as const, text, oldNumber: null, newNumber: i + 1 })),
    ];
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i], oldNumber: i + 1, newNumber: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: 'remove', text: a[i], oldNumber: i + 1, newNumber: null });
      i++;
    } else {
      lines.push({ kind: 'add', text: b[j], oldNumber: null, newNumber: j + 1 });
      j++;
    }
  }
  while (i < n) {
    lines.push({ kind: 'remove', text: a[i], oldNumber: i + 1, newNumber: null });
    i++;
  }
  while (j < m) {
    lines.push({ kind: 'add', text: b[j], oldNumber: null, newNumber: j + 1 });
    j++;
  }
  return lines;
}

/** Parse a standard `diff -u` payload into renderable lines. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;

  for (const raw of diff.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      oldNumber = match ? Number(match[1]) : 0;
      newNumber = match ? Number(match[2]) : 0;
      lines.push({ kind: 'hunk', text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff ')) {
      lines.push({ kind: 'meta', text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), oldNumber: null, newNumber: newNumber++ });
      continue;
    }
    if (raw.startsWith('-')) {
      lines.push({ kind: 'remove', text: raw.slice(1), oldNumber: oldNumber++, newNumber: null });
      continue;
    }
    if (raw.startsWith('\\')) {
      lines.push({ kind: 'meta', text: raw, oldNumber: null, newNumber: null });
      continue;
    }
    lines.push({
      kind: 'context',
      text: raw.startsWith(' ') ? raw.slice(1) : raw,
      oldNumber: oldNumber++,
      newNumber: newNumber++,
    });
  }

  /* Drop a trailing blank line produced by the terminating newline. */
  const last = lines[lines.length - 1];
  if (last && last.kind === 'context' && last.text === '') lines.pop();
  return lines;
}

const KIND_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--foreground)]',
  remove: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--foreground)]',
  context: 'text-[var(--foreground)]',
  hunk: 'bg-[var(--surface-2)] text-[var(--muted)]',
  meta: 'text-[var(--muted)]',
};

const MARKER: Record<DiffLineKind, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  hunk: '',
  meta: '',
};

export interface DiffViewProps {
  /** Server-produced unified diff. Takes precedence over `from`/`to`. */
  diff?: string | null;
  from?: string;
  to?: string;
  fromLabel?: string;
  toLabel?: string;
  className?: string;
  maxHeight?: number | string;
  /** Hide unchanged lines further than this many lines from a change. */
  contextLines?: number;
}

export function DiffView({
  diff,
  from = '',
  to = '',
  fromLabel = 'from',
  toLabel = 'to',
  className,
  maxHeight = 520,
  contextLines = 3,
}: DiffViewProps) {
  const lines = useMemo(
    () => (diff ? parseUnifiedDiff(diff) : computeUnifiedDiff(from, to)),
    [diff, from, to],
  );

  const visible = useMemo(() => collapseContext(lines, contextLines), [lines, contextLines]);
  const stats = useMemo(
    () => ({
      added: lines.filter((l) => l.kind === 'add').length,
      removed: lines.filter((l) => l.kind === 'remove').length,
    }),
    [lines],
  );

  const rawText = useMemo(
    () => diff ?? lines.map((l) => `${MARKER[l.kind]}${l.text}`).join('\n'),
    [diff, lines],
  );

  if (stats.added === 0 && stats.removed === 0) {
    return (
      <div
        className={cn(
          'rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-6 text-center text-xs text-[var(--muted)]',
          className,
        )}
      >
        No differences between <span className="font-mono">{fromLabel}</span> and{' '}
        <span className="font-mono">{toLabel}</span>.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-2xs">
          <span className="truncate font-mono text-[var(--muted)]">
            {fromLabel} → {toLabel}
          </span>
          <span className="text-[var(--success)]">+{stats.added}</span>
          <span className="text-[var(--danger)]">−{stats.removed}</span>
        </div>
        <CopyButton value={rawText} tooltip="Copy diff" />
      </div>
      <div
        className="overflow-auto font-mono text-[12.5px] leading-5"
        style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {visible.map((line, index) =>
              line === 'gap' ? (
                <tr key={`gap-${index}`}>
                  <td
                    colSpan={3}
                    className="select-none border-y border-[var(--border)] bg-[var(--surface-2)] px-3 py-0.5 text-center text-2xs text-[var(--muted)]"
                  >
                    ⋯
                  </td>
                </tr>
              ) : (
                <tr key={index} className={KIND_CLASS[line.kind]}>
                  <td className="w-12 select-none border-r border-[var(--border)] px-2 text-right align-top text-2xs text-[var(--muted)] tabular-nums">
                    {line.oldNumber ?? ''}
                  </td>
                  <td className="w-12 select-none border-r border-[var(--border)] px-2 text-right align-top text-2xs text-[var(--muted)] tabular-nums">
                    {line.newNumber ?? ''}
                  </td>
                  <td className="whitespace-pre-wrap break-all px-3">
                    <span
                      className={cn(
                        'select-none pr-1',
                        line.kind === 'add' && 'text-[var(--success)]',
                        line.kind === 'remove' && 'text-[var(--danger)]',
                        line.kind === 'context' && 'text-[var(--muted)]',
                      )}
                    >
                      {MARKER[line.kind]}
                    </span>
                    {line.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function collapseContext(lines: DiffLine[], contextLines: number): (DiffLine | 'gap')[] {
  if (contextLines < 0) return lines;
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'add' || line.kind === 'remove' || line.kind === 'hunk') {
      for (
        let i = Math.max(0, index - contextLines);
        i <= Math.min(lines.length - 1, index + contextLines);
        i++
      ) {
        keep[i] = true;
      }
    }
  });

  const out: (DiffLine | 'gap')[] = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep[index]) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push('gap');
      skipping = true;
    }
  });
  return out;
}
