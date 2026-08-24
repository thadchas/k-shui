import { Link } from 'react-router';
import { Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

export interface ComingSoonProps {
  title: string;
  description?: string;
  /** API endpoints this page will consume, shown as a hint for the next agent. */
  endpoints?: string[];
  backTo?: string;
  backLabel?: string;
}

/**
 * Placeholder for routes owned by a later agent. Replace the whole file when the
 * real page lands — the route entry in `src/routes.tsx` already points here.
 */
export function ComingSoon({ title, description, endpoints, backTo, backLabel }: ComingSoonProps) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
        <EmptyState
          icon={Construction}
          title="Not implemented yet"
          description={
            <>
              This area is under construction.
              {endpoints?.length ? (
                <span className="mt-3 block space-y-1 text-left font-mono text-2xs text-[var(--muted)]">
                  {endpoints.map((e) => (
                    <span key={e} className="block">
                      {e}
                    </span>
                  ))}
                </span>
              ) : null}
            </>
          }
          action={
            backTo ? (
              <Button asChild variant="outline">
                <Link to={backTo}>{backLabel ?? 'Go back'}</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

export default ComingSoon;
