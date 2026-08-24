import { GripVertical } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn('flex size-full data-[panel-group-direction=vertical]:flex-col', className)}
    {...props}
  />
);

export const ResizablePanel = ResizablePrimitive.Panel;

export const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      'relative flex w-px items-center justify-center bg-[var(--border)] transition-colors',
      'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]',
      'data-[resize-handle-state=drag]:bg-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_50%,var(--border))]',
      'data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full',
      className,
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-5 w-3 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface)]">
        <GripVertical className="size-2.5 text-[var(--muted)]" />
      </div>
    ) : null}
  </ResizablePrimitive.PanelResizeHandle>
);
