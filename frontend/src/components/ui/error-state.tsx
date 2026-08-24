import { AlertTriangle, PlugZap, RefreshCw, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  compact?: boolean;
}

function describe(error: unknown): { title: string; detail: string; icon: typeof AlertTriangle } {
  if (error instanceof ApiError) {
    if (error.isIntegrationUnavailable) {
      return {
        title: error.title || 'Integration unavailable',
        detail:
          error.detail ||
          'This integration is not configured or could not be reached. Check the cluster configuration.',
        icon: PlugZap,
      };
    }
    if (error.isUnauthorized || error.isForbidden) {
      return {
        title: error.title || 'Not permitted',
        detail: error.detail || 'Your account does not have access to this resource.',
        icon: ShieldAlert,
      };
    }
    return { title: error.title, detail: error.detail, icon: AlertTriangle };
  }
  if (error instanceof Error) {
    return { title: 'Something went wrong', detail: error.message, icon: AlertTriangle };
  }
  return { title: 'Something went wrong', detail: String(error ?? ''), icon: AlertTriangle };
}

export function ErrorState({ error, onRetry, title, className, compact }: ErrorStateProps) {
  const info = describe(error);
  const Icon = info.icon;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
      role="alert"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]">
        <Icon className="size-5 text-[var(--danger)]" />
      </div>
      <div className="max-w-lg space-y-1">
        <p className="text-base font-semibold text-[var(--foreground)]">{title ?? info.title}</p>
        {info.detail ? (
          <p className="text-xs leading-5 text-[var(--muted)]">{info.detail}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Slim inline variant for cards/panels. */
export function InlineError({ error, onRetry, className }: ErrorStateProps) {
  const info = describe(error);
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2',
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--foreground)]">{info.title}</p>
        {info.detail ? <p className="mt-0.5 text-xs text-[var(--muted)]">{info.detail}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="ghost" size="icon-sm" onClick={onRetry} aria-label="Retry">
          <RefreshCw />
        </Button>
      ) : null}
    </div>
  );
}
