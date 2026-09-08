import type { AgentOperation } from '@/api/agentTypes';

export function safeEvidenceHref(href?: string): string | null {
  return href && /^\/(?:c\/|audit(?:[/?]|$))/.test(href) && !/[\\\r\n]/.test(href) ? href : null;
}
export function operationCanExecute(
  operation: AgentOperation,
  confirmation: string,
  now = Date.now(),
): boolean {
  return (
    ['prepared', 'awaiting_confirmation'].includes(operation.status) &&
    Date.parse(operation.expiresAt) > now &&
    (!operation.requiresConfirmation ||
      (!!operation.confirmationText && confirmation === operation.confirmationText))
  );
}
export function stateLabel(state: string): string {
  return state.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
}
export { investigationWindow } from '@/lib/agentContext';
