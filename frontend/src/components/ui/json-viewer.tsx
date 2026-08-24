import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';

type Json = unknown;

function typeOf(value: Json): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

const VALUE_CLASS: Record<string, string> = {
  string: 'text-[var(--success)]',
  number: 'text-[var(--accent)]',
  bigint: 'text-[var(--accent)]',
  boolean: 'text-[var(--warning)]',
  null: 'text-[var(--muted)]',
  undefined: 'text-[var(--muted)]',
};

function preview(value: Json): string {
  const t = typeOf(value);
  if (t === 'array') return `Array(${(value as unknown[]).length})`;
  if (t === 'object') return `{${Object.keys(value as object).length}}`;
  return '';
}

interface NodeProps {
  name: string | null;
  value: Json;
  depth: number;
  defaultExpandedDepth: number;
  isLast: boolean;
}

function JsonNode({ name, value, depth, defaultExpandedDepth, isLast }: NodeProps) {
  const t = typeOf(value);
  const expandable = t === 'object' || t === 'array';
  const [open, setOpen] = React.useState(depth < defaultExpandedDepth);

  const entries = React.useMemo<[string, Json][]>(() => {
    if (t === 'array') return (value as unknown[]).map((v, i) => [String(i), v]);
    if (t === 'object') return Object.entries(value as Record<string, unknown>);
    return [];
  }, [value, t]);

  const keyLabel =
    name === null ? null : (
      <span className="text-[var(--foreground)]">
        <span className="text-[var(--muted)]">&quot;</span>
        {name}
        <span className="text-[var(--muted)]">&quot;</span>
        <span className="text-[var(--muted)]">: </span>
      </span>
    );

  if (!expandable) {
    const rendered =
      t === 'string' ? `"${value as string}"` : t === 'undefined' ? 'undefined' : String(value);
    return (
      <div className="flex items-start gap-1 pl-[13px]" style={{ paddingLeft: depth * 14 + 13 }}>
        {keyLabel}
        <span className={cn('break-all', VALUE_CLASS[t] ?? 'text-[var(--foreground)]')}>
          {rendered}
        </span>
        {!isLast ? <span className="text-[var(--muted)]">,</span> : null}
      </div>
    );
  }

  const openBrace = t === 'array' ? '[' : '{';
  const closeBrace = t === 'array' ? ']' : '}';

  return (
    <div>
      <div className="flex items-start" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-[1px] shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span className="ml-0.5">
          {keyLabel}
          <span className="text-[var(--muted)]">{openBrace}</span>
          {!open ? (
            <>
              <span className="px-1 text-2xs text-[var(--muted)]">{preview(value)}</span>
              <span className="text-[var(--muted)]">
                {closeBrace}
                {!isLast ? ',' : ''}
              </span>
            </>
          ) : null}
        </span>
      </div>
      {open ? (
        <>
          {entries.map(([k, v], i) => (
            <JsonNode
              key={k}
              name={t === 'array' ? null : k}
              value={v}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              isLast={i === entries.length - 1}
            />
          ))}
          <div style={{ paddingLeft: depth * 14 + 13 }} className="text-[var(--muted)]">
            {closeBrace}
            {!isLast ? ',' : ''}
          </div>
        </>
      ) : null}
    </div>
  );
}

export interface JsonViewerProps {
  /** Object, array, primitive, or a JSON string (parsed automatically). */
  value: unknown;
  className?: string;
  maxHeight?: number | string;
  defaultExpandedDepth?: number;
  showCopy?: boolean;
  /** Rendered when the value is a non-JSON string. */
  fallbackAsText?: boolean;
}

export function JsonViewer({
  value,
  className,
  maxHeight = 420,
  defaultExpandedDepth = 2,
  showCopy = true,
  fallbackAsText = true,
}: JsonViewerProps) {
  const parsed = React.useMemo(() => {
    if (typeof value !== 'string') return { data: value, isText: false };
    const trimmed = value.trim();
    if (!trimmed || !/^[[{"]|^-?\d|^true$|^false$|^null$/.test(trimmed)) {
      return { data: value, isText: true };
    }
    try {
      return { data: JSON.parse(trimmed) as unknown, isText: false };
    } catch {
      return { data: value, isText: true };
    }
  }, [value]);

  const raw = React.useMemo(() => {
    try {
      return typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data, null, 2);
    } catch {
      return String(parsed.data);
    }
  }, [parsed.data]);

  if (parsed.isText && fallbackAsText) {
    return (
      <div
        className={cn(
          'group relative rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)]',
          className,
        )}
      >
        {showCopy ? (
          <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton value={raw} className="bg-[var(--surface)]" />
          </div>
        ) : null}
        <pre
          className="overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[13px] leading-5"
          style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
        >
          {raw}
        </pre>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)]',
        className,
      )}
    >
      {showCopy ? (
        <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton value={raw} className="bg-[var(--surface)]" />
        </div>
      ) : null}
      <div
        className="overflow-auto p-3 font-mono text-[13px] leading-5"
        style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
      >
        <JsonNode
          name={null}
          value={parsed.data}
          depth={0}
          defaultExpandedDepth={defaultExpandedDepth}
          isLast
        />
      </div>
    </div>
  );
}
