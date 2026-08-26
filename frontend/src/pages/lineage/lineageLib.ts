import type { LineageNodeFull, LineageSource } from '@/api/types';

export const LINEAGE_SOURCES: { label: string; value: LineageSource; hint: string }[] = [
  { label: 'Marquez', value: 'marquez', hint: 'OpenLineage jobs, datasets and runs' },
  { label: 'Connect', value: 'connect', hint: 'Connector → topic edges' },
  { label: 'Flink', value: 'flink', hint: 'Flink jobs and their topics' },
  { label: 'ksqlDB', value: 'ksql', hint: 'ksqlDB streams and queries' },
  { label: 'Consumers', value: 'consumers', hint: 'Consumer group → topic edges' },
];

export const ALL_SOURCES: LineageSource[] = LINEAGE_SOURCES.map((s) => s.value);

/**
 * Node ids are `type:cluster[:scope]:name`. Rewrite loose ids such as
 * `topic:orders.v1` (used by cross-page deep links) into the canonical form.
 */
export function normalizeFocusId(focus: string | null, cluster: string): string | null {
  if (!focus) return null;
  const parts = focus.split(':');
  if (parts.length < 2) return focus;
  if (parts[1] === cluster) return focus;
  return `${parts[0]}:${cluster}:${parts.slice(1).join(':')}`;
}

/** Deep link into the feature page that owns this lineage node, if any. */
export function lineageNodeLink(
  node: LineageNodeFull,
  cluster: string,
): { to: string; label: string } | null {
  const parts = node.id.split(':');
  const name = parts.slice(2).join(':');
  switch (node.type) {
    case 'topic':
      return name
        ? { to: `/c/${cluster}/topics/${encodeURIComponent(name)}`, label: 'Open in Topics' }
        : null;
    case 'connector': {
      const kc = parts[2];
      const connector = parts.slice(3).join(':');
      return kc && connector
        ? {
            to: `/c/${cluster}/connect/${encodeURIComponent(kc)}/connectors/${encodeURIComponent(
              connector,
            )}`,
            label: 'Open in Connect',
          }
        : { to: `/c/${cluster}/connect`, label: 'Open in Connect' };
    }
    case 'flinkJob': {
      const fc = parts[2];
      const jid = parts.slice(3).join(':');
      return fc && jid
        ? {
            to: `/c/${cluster}/flink/${encodeURIComponent(fc)}/jobs/${jid}`,
            label: 'Open in Flink',
          }
        : { to: `/c/${cluster}/flink`, label: 'Open in Flink' };
    }
    case 'consumerGroup':
      return name
        ? { to: `/c/${cluster}/consumers/${encodeURIComponent(name)}`, label: 'Open in Consumers' }
        : null;
    case 'ksqlQuery':
      return { to: `/c/${cluster}/ksql`, label: 'Open in ksqlDB' };
    case 'schema':
      return name
        ? { to: `/c/${cluster}/schemas/${encodeURIComponent(name)}`, label: 'Open in Schemas' }
        : null;
    default:
      return null;
  }
}

export function shortNodeId(id: string, max = 40): string {
  return id.length > max ? `…${id.slice(id.length - max)}` : id;
}
