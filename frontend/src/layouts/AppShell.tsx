import { Outlet, useParams } from 'react-router';
import { useClusters } from '@/api/hooks/clusters';
import { useInfo } from '@/api/hooks/system';
import { CommandPalette } from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const { cluster: clusterParam } = useParams<{ cluster: string }>();
  const clusterId = clusterParam ?? null;
  const { data: info } = useInfo();
  const { data: clusters } = useClusters();

  const cluster = clusters?.find((c) => c.id === clusterId);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--background)]">
      <Sidebar clusterId={clusterId} features={cluster?.features} version={info?.version} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar clusterId={clusterId} cluster={cluster} info={info} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <CommandPalette clusterId={clusterId} />
    </div>
  );
}

export default AppShell;
