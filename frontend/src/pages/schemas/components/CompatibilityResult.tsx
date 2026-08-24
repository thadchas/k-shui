import { CheckCircle2, XCircle } from 'lucide-react';
import type { CompatibilityCheckResponse } from '@/api/types';
import { cn } from '@/lib/utils';

export interface CompatibilityResultProps {
  result: CompatibilityCheckResponse | undefined | null;
  className?: string;
}

/** Result banner for `POST .../subjects/{s}/compatibility`. */
export function CompatibilityResult({ result, className }: CompatibilityResultProps) {
  if (!result) return null;
  const ok = result.isCompatible;
  const Icon = ok ? CheckCircle2 : XCircle;

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2',
        ok
          ? 'border-[color-mix(in_srgb,var(--success)_35%,var(--border))] bg-[color-mix(in_srgb,var(--success)_8%,transparent)]'
          : 'border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]',
        className,
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          ok ? 'text-[var(--success)]' : 'text-[var(--danger)]',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--foreground)]">
          {ok ? 'Compatible with the current version' : 'Not compatible'}
        </p>
        {result.messages?.length ? (
          <ul className="mt-1 space-y-0.5">
            {result.messages.map((message, index) => (
              <li key={index} className="break-words font-mono text-2xs text-[var(--muted)]">
                {message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
