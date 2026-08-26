import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4 whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--primary)]',
        secondary: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]',
        outline: 'border-[var(--border)] bg-transparent text-[var(--foreground)]',
        success:
          'border-transparent bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]',
        warning:
          'border-transparent bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]',
        danger:
          'border-transparent bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)]',
        info: 'border-transparent bg-[color-mix(in_srgb,var(--info)_16%,transparent)] text-[var(--info)]',
        accent:
          'border-transparent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]',
      },
      size: {
        sm: 'px-1.5 py-0 text-2xs',
        md: 'px-2 py-0.5 text-2xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
