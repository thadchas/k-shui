import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
  invalid?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, mono, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-20 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors duration-150',
        'placeholder:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--primary)] focus-visible:border-[var(--primary)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        mono && 'font-mono text-[13px] leading-5',
        invalid && 'border-[var(--danger)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
