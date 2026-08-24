import { cn } from '@/lib/utils';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 font-sans text-2xs font-medium text-[var(--muted)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
