import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface UnsavedChangesGuardProps {
  /** While true, in-app navigation is intercepted and a `beforeunload` prompt is installed. */
  dirty: boolean;
  description?: React.ReactNode;
}

/**
 * Blocks router navigation while `dirty`, asking "Discard unsaved changes?" via a Dialog, and
 * installs a `beforeunload` listener so a tab close / reload also prompts.
 */
export function UnsavedChangesGuard({
  dirty,
  description = 'You have unsaved changes that will be lost if you leave this page.',
}: UnsavedChangesGuardProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // If the page becomes clean while a navigation is blocked, let it through.
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.reset();
  }, [dirty, blocker]);

  const open = blocker.state === 'blocked';

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && open ? blocker.reset() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]">
              <AlertTriangle className="size-4 text-[var(--warning)]" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            Stay on page
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
