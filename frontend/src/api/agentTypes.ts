export interface AgentResource {
  type: string;
  name: string;
  connectCluster?: string;
  namespace?: string;
}
export interface AgentContext {
  clusterId?: string;
  resource?: AgentResource;
  timeWindow?: { start?: string; end?: string };
  prompt?: string;
}
export type AgentMode = 'inspect' | 'operate';
export interface AgentConnection {
  id: string;
  name: string;
  provider: string;
  model: string;
  managed: boolean;
  credentialConfigured: boolean;
  state: string;
  recovery?: string;
  allowedClusters: string[];
  allowedTools?: string[];
  testedAt?: string;
}
export interface AgentStatus {
  reason?: string | null;
  enabled: boolean;
  actingUser: string;
  effectiveModes: AgentMode[];
  policy: {
    allowPayloads: boolean;
    maxToolCalls: number;
    maxRunSeconds: number;
    maxInputChars: number;
    maxOutputTokens: number;
    maxRunCostUsd: number;
  };
  connections: AgentConnection[];
  unsupportedConnections: unknown[];
}
export interface AgentEvidence {
  id: string;
  clusterId: string;
  tool: string;
  resource: string | Record<string, unknown>;
  href: string;
  observedAt: string;
  status: string;
  data: unknown;
  limitations: string[];
  refreshedFrom?: string;
}
export interface AgentOperation {
  id: string;
  investigationId: string;
  clusterId: string;
  user: string;
  action: string;
  target: { name: string; connectName?: string; taskId?: number };
  parameters: unknown;
  before: unknown;
  preview: unknown;
  after?: unknown;
  status: string;
  requiresConfirmation: boolean;
  confirmationText?: string;
  expiresAt: string;
  createdAt: string;
  href?: string;
  error?: string;
}
export interface AgentInvestigation {
  id: string;
  title: string;
  clusterId: string;
  resource?: AgentResource;
  timeWindow?: { start?: string; end?: string };
  connectionId: string;
  provider: string;
  model: string;
  mode: AgentMode;
  actingUser: string;
  status: string;
  messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    evidenceIds?: string[];
  }[];
  evidence: AgentEvidence[];
  operations?: AgentOperation[];
  progress: { id?: string; message?: string; tool?: string; status?: string; createdAt?: string }[];
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  error?: { state: string; message: string; recovery: string };
  createdAt: string;
  updatedAt: string;
}
export interface CreateInvestigation {
  clusterId: string;
  connectionId: string;
  mode: AgentMode;
  resource?: AgentResource;
  timeWindow?: { start?: string; end?: string };
  title?: string;
}
