import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useAgentStatus } from '@/api/hooks/agent';
import { useAgentStore } from '@/stores/agent';
import { Sparkles } from 'lucide-react';
import { AgentWorkspace } from '@/components/agent/AgentWorkspace';

export function AgentPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const status = useAgentStatus();
  useEffect(() => {
    if (id && status.data?.enabled) useAgentStore.getState().selectInvestigation(id);
  }, [id, status.data?.enabled, status.data?.actingUser]);
  return (
    <section className="mx-auto flex h-[calc(100dvh-8rem)] min-h-96 w-full max-w-6xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
      <header className="border-b border-[var(--border)] p-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-[var(--primary)]" />
          K-Shui investigations
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Follow the evidence, prepare a change, and verify the outcome.
        </p>
      </header>
      <AgentWorkspace />
    </section>
  );
}
