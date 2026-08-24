import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';

export interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  maxHeight?: number | string;
  showCopy?: boolean;
  wrap?: boolean;
  title?: React.ReactNode;
}

export function CodeBlock({
  code,
  language,
  className,
  maxHeight = 420,
  showCopy = true,
  wrap = false,
  title,
}: CodeBlockProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)]',
        className,
      )}
    >
      {title || language ? (
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
          <span className="text-2xs font-medium uppercase tracking-wide text-[var(--muted)]">
            {title ?? language}
          </span>
          {showCopy ? <CopyButton value={code} /> : null}
        </div>
      ) : showCopy ? (
        <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <CopyButton value={code} className="bg-[var(--surface)]" />
        </div>
      ) : null}
      <pre
        className={cn(
          'overflow-auto p-3 font-mono text-[13px] leading-5 text-[var(--foreground)]',
          wrap && 'whitespace-pre-wrap break-all',
        )}
        style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline monospace value with optional copy affordance. */
export function CodeInline({
  children,
  className,
  copyValue,
}: {
  children: React.ReactNode;
  className?: string;
  copyValue?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <code
        className={cn(
          'rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--foreground)]',
          className,
        )}
      >
        {children}
      </code>
      {copyValue ? <CopyButton value={copyValue} /> : null}
    </span>
  );
}
