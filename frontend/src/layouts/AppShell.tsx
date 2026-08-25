import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { useClusters } from '@/api/hooks/clusters';
import { useInfo } from '@/api/hooks/system';
import { qk } from '@/api/keys';
import type { InfoResponse } from '@/api/types';
import { CommandPalette } from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuthStore } from '@/stores/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const { cluster: clusterParam } = useParams<{ cluster: string }>();
  const clusterId = clusterParam ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: info } = useInfo();
  const { data: clusters } = useClusters();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const ackSessionExpired = useAuthStore((s) => s.ackSessionExpired);

  // The fetch layer flags 401s; we own the router, so redirect from here and refresh /info so
  // the shell's auth gate below agrees with the server.
  useEffect(() => {
    if (!sessionExpired) return;
    ackSessionExpired();
    // Drop the cached user first so LoginPage does not bounce back on the stale /info
    // (it would otherwise see a server session and send us straight back here).
    qc.setQueryData<InfoResponse>(qk.info(), (old) =>
      old ? { ...old, auth: { ...old.auth, user: null } } : old,
    );
    void qc.invalidateQueries({ queryKey: qk.info() });
    if (!info?.auth.enabled) return;
    void navigate('/login', {
      replace: true,
      state: { from: location.pathname + location.search },
    });
  }, [sessionExpired, ackSessionExpired, info?.auth.enabled, qc, navigate, location]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const cluster = clusters?.find((c) => c.id === clusterId);
  const unknownCluster = Boolean(clusterId && clusters && !cluster);

  // `/info` answers anonymous callers with just the auth block, so an enabled auth type
  // with no resolved user means the session is missing or expired. Without this the
  // shell renders an "Unauthorized" panel with no way to sign in.
  if (info?.auth.enabled && !info.auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--background)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)] focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <Sidebar
        clusterId={clusterId}
        features={cluster?.features}
        version={info?.version}
        className="hidden md:flex"
      />

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" size="sm" className="w-[280px] p-0 md:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar
            clusterId={clusterId}
            features={cluster?.features}
            version={info?.version}
            variant="drawer"
            className="flex w-full border-r-0"
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          clusterId={clusterId}
          cluster={cluster}
          info={info}
          onOpenMenu={() => setDrawerOpen(true)}
        />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
            {unknownCluster ? (
              <EmptyState
                icon={Boxes}
                title="Unknown cluster"
                description={
                  <>
                    No cluster with id <span className="font-mono">{clusterId}</span> is configured
                    on this server.
                  </>
                }
                action={
                  <Button asChild>
                    <Link to="/clusters">View all clusters</Link>
                  </Button>
                }
              />
            ) : (
              <ErrorBoundary key={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            )}
          </div>
        </main>
      </div>
      <CommandPalette clusterId={clusterId} />
    </div>
  );
}

export default AppShell;
