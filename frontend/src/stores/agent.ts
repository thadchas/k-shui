import { create } from 'zustand';
import type { AgentContext } from '@/api/agentTypes';

interface AgentState {
  owner: string | null;
  draft: string;
  bindIdentity: (owner: string) => void;
  setDraft: (draft: string) => void;
  open: boolean;
  context: AgentContext;
  investigationId: string | null;
  width: number;
  openPanel: (context?: AgentContext) => void;
  closePanel: () => void;
  selectInvestigation: (id: string | null) => void;
  setContext: (context: AgentContext) => void;
  setWidth: (width: number) => void;
}
// Only transient UI state lives in the browser; transcripts and connections remain server-side.
export const useAgentStore = create<AgentState>((set) => ({
  owner: null,
  draft: '',
  bindIdentity: (owner) =>
    set((state) =>
      state.owner === owner
        ? state
        : {
            owner,
            ...(state.owner !== null
              ? { context: {}, investigationId: null, draft: '', open: false }
              : {}),
          },
    ),
  setDraft: (draft) => set({ draft }),
  open: false,
  context: {},
  investigationId: null,
  width: 560,
  openPanel: (context) =>
    set((state) => ({
      open: true,
      ...(context
        ? { context, investigationId: null, draft: context.prompt ?? '' }
        : { context: state.context }),
    })),
  closePanel: () => set({ open: false }),
  selectInvestigation: (investigationId) => set({ investigationId, draft: '' }),
  setContext: (context) => set({ context, investigationId: null, draft: context.prompt ?? '' }),
  setWidth: (width) => set({ width: Math.min(960, Math.max(380, width)) }),
}));
