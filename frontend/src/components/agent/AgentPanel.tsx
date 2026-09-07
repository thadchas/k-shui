import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link, useParams } from 'react-router';
import { Maximize2, Sparkles, X } from 'lucide-react';
import type { AgentContext } from '@/api/agentTypes';
import { useAgentStatus, useInvestigation } from '@/api/hooks/agent';
import { useAgentStore } from '@/stores/agent';
import { Button } from '@/components/ui/button';
import { AgentWorkspace } from './AgentWorkspace';

export function AskKShuiButton({ clusterId }: { clusterId?: string | null }) {
  const { cluster } = useParams<{ cluster: string }>();
  const status = useAgentStatus();
  const openPanel = useAgentStore((s) => s.openPanel);
  if (!status.data?.enabled) return null;
  return (
    <Button
      aria-label="Ask K-Shui"
      variant="outline"
      onClick={() => openPanel({ clusterId: clusterId ?? cluster })}
    >
      <Sparkles />
      <span className="hidden sm:inline">Ask K-Shui</span>
      <span className="sr-only sm:hidden">Ask K-Shui</span>
    </Button>
  );
}

export function InvestigateButton({
  context,
  className,
  children,
}: {
  context: AgentContext;
  className?: string;
  children?: ReactNode;
}) {
  const status = useAgentStatus();
  const openPanel = useAgentStore((s) => s.openPanel);
  if (!status.data?.enabled) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        openPanel(context);
      }}
    >
      <Sparkles />
      {children ?? 'Investigate'}
    </Button>
  );
}

export function AgentPanel() {
  const { open, closePanel, width, setWidth, context, investigationId } = useAgentStore();
  const { cluster } = useParams<{ cluster: string }>();
  const detail = useInvestigation(investigationId);
  const scopedCluster = detail.data?.clusterId ?? context.clusterId ?? cluster;
  const expandedHref = `${scopedCluster ? `/c/${encodeURIComponent(scopedCluster)}/agent` : '/agent'}${investigationId ? `?id=${encodeURIComponent(investigationId)}` : ''}`;
  const status = useAgentStatus();
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open && !!status.data?.enabled}
      onOpenChange={(value) => {
        if (!value) closePanel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          style={{ width: `min(100vw, ${width}px)` }}
          className="fixed inset-y-0 right-0 z-50 flex min-h-0 max-w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] focus:outline-none"
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <div
            role="separator"
            aria-label="Resize K-Shui Agent panel"
            aria-orientation="vertical"
            aria-valuemin={380}
            aria-valuemax={960}
            aria-valuenow={width}
            tabIndex={0}
            className="absolute inset-y-0 left-0 hidden w-2 cursor-col-resize focus-visible:bg-[var(--primary)] focus-visible:outline-none md:block"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                setWidth(width + (e.key === 'ArrowLeft' ? 40 : -40));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setWidth(380);
              } else if (e.key === 'End') {
                e.preventDefault();
                setWidth(960);
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setWidth(window.innerWidth - e.clientX);
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          />
          <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-4">
            <div>
              <Dialog.Title className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-[var(--primary)]" />
                K-Shui Agent
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-[var(--muted)]">
                A scoped investigation under your authority.
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" asChild>
                <Link to={expandedHref} aria-label="Expand investigation" onClick={closePanel}>
                  <Maximize2 />
                </Link>
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close K-Shui Agent">
                  <X />
                </Button>
              </Dialog.Close>
            </div>
          </header>
          <AgentWorkspace />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
