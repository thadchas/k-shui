import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono, invalid, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-8 w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-sm text-[var(--foreground)] transition-colors duration-150',
        'placeholder:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--primary)] focus-visible:border-[var(--primary)]',
        'disabled:cursor-not-allowed disabled:opacity-60 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        mono && 'font-mono text-[13px]',
        invalid && 'border-[var(--danger)] focus-visible:outline-[var(--danger)]',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
