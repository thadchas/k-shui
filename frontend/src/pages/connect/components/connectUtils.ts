import type { Connector, ConnectorTask } from '@/api/types';
import type { StatusTone } from '@/components/ui/status-pill';

export const CONNECTOR_STATES = [
  'RUNNING',
  'PAUSED',
  'STOPPED',
  'FAILED',
  'UNASSIGNED',
  'RESTARTING',
];

/** `org.apache.kafka.connect.file.FileStreamSinkConnector` → `FileStreamSinkConnector`. */
export function shortClass(connectorClass: string | null | undefined): string {
  if (!connectorClass) return '—';
  const parts = connectorClass.split('.');
  return parts[parts.length - 1] || connectorClass;
}

export function connectorStateTone(state: string | null | undefined): StatusTone {
  switch ((state ?? '').toUpperCase()) {
    case 'RUNNING':
      return 'success';
    case 'PAUSED':
    case 'RESTARTING':
      return 'warning';
    case 'FAILED':
      return 'danger';
    case 'STOPPED':
    case 'UNASSIGNED':
      return 'muted';
    default:
      return 'muted';
  }
}

export interface TaskCounts {
  total: number;
  running: number;
  failed: number;
  paused: number;
  other: number;
}

export function taskCounts(tasks: ConnectorTask[] | undefined | null): TaskCounts {
  const list = tasks ?? [];
  let running = 0;
  let failed = 0;
  let paused = 0;
  for (const task of list) {
    const state = (task.state ?? '').toUpperCase();
    if (state === 'RUNNING') running++;
    else if (state === 'FAILED') failed++;
    else if (state === 'PAUSED') paused++;
  }
  return {
    total: list.length,
    running,
    failed,
    paused,
    other: list.length - running - failed - paused,
  };
}

/** Connect connectors that make up a MirrorMaker 2 / Replicator flow. */
export type MirrorRole = 'source' | 'checkpoint' | 'heartbeat' | 'replicator' | null;

export function mirrorRole(nameOrClass: string | null | undefined): MirrorRole {
  const value = (nameOrClass ?? '').toLowerCase();
  if (value.includes('mirrorsource') || value.includes('mirror-source')) return 'source';
  if (value.includes('checkpoint')) return 'checkpoint';
  if (value.includes('heartbeat')) return 'heartbeat';
  if (value.includes('replicator')) return 'replicator';
  return null;
}

export function isMirrorConnector(connector: Connector): boolean {
  return mirrorRole(connector.connectorClass) !== null || mirrorRole(connector.name) !== null;
}

/** Config keys we never want to render in plain text. */
export function maskConfigValue(name: string, value: string): string {
  return /password|secret|credential|token|\.key$|keystore|truststore/i.test(name)
    ? '••••••••'
    : value;
}

export const IMPORTANCE_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Connect definition types → the input control we render. */
export type ConfigInputKind = 'boolean' | 'number' | 'password' | 'list' | 'select' | 'text';

export function inputKind(type: string, recommendedValues: string[] | undefined): ConfigInputKind {
  if (recommendedValues && recommendedValues.length > 0) return 'select';
  switch ((type ?? '').toUpperCase()) {
    case 'BOOLEAN':
      return 'boolean';
    case 'INT':
    case 'LONG':
    case 'SHORT':
    case 'DOUBLE':
    case 'FLOAT':
      return 'number';
    case 'PASSWORD':
      return 'password';
    case 'LIST':
      return 'list';
    default:
      return 'text';
  }
}
