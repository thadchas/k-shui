/**
 * Pure logic behind the command palette's resource search.
 *
 * The palette queries several independent backends (Kafka, Connect, Flink, Schema
 * Registry, the alerts store). Any of them can be missing or unreachable, so the
 * palette never collapses a failure into "no results": each source carries its own
 * status and an unavailable source is rendered as a retry row while every other
 * source keeps showing its matches.
 *
 * Nothing in this module touches the network or React — it is imported by
 * `CommandPalette.tsx` and unit-tested in `commandPaletteSources.test.ts`.
 */
import type {
  AlertTrigger,
  ConsumerGroupSummary,
  Connector,
  FlinkJob,
  SchemaSubjectSummary,
  TopicSummary,
} from '@/api/types';

/* -------------------------------------------------------------------------- *
 * Resource types
 * -------------------------------------------------------------------------- */

export type ResourceKind = 'topic' | 'group' | 'connector' | 'flinkJob' | 'schema' | 'alert';

export interface ResourceTypeDef {
  kind: ResourceKind;
  /** Group heading in the palette. */
  label: string;
  /** Short label used by the filter chips. */
  chip: string;
  /** Backend this source talks to — used in the "… unavailable" row. */
  source: string;
  /** Canonical prefix written by the chips (`t` → `t: orders`). */
  prefix: string;
  /** Every accepted prefix, lowercase. */
  prefixes: string[];
}

export const RESOURCE_TYPES: readonly ResourceTypeDef[] = [
  {
    kind: 'topic',
    label: 'Topics',
    chip: 'Topics',
    source: 'Topic search',
    prefix: 't',
    prefixes: ['t', 'topic', 'topics'],
  },
  {
    kind: 'group',
    label: 'Consumer groups',
    chip: 'Groups',
    source: 'Consumer group search',
    prefix: 'cg',
    prefixes: ['cg', 'g', 'group', 'groups', 'consumer', 'consumers'],
  },
  {
    kind: 'connector',
    label: 'Connectors',
    chip: 'Connectors',
    source: 'Connect',
    prefix: 'c',
    prefixes: ['c', 'conn', 'connector', 'connectors'],
  },
  {
    kind: 'flinkJob',
    label: 'Flink jobs',
    chip: 'Flink jobs',
    source: 'Flink',
    prefix: 'j',
    prefixes: ['j', 'job', 'jobs', 'flink'],
  },
  {
    kind: 'schema',
    label: 'Schemas',
    chip: 'Schemas',
    source: 'Schema Registry',
    prefix: 's',
    prefixes: ['s', 'schema', 'schemas', 'subject', 'subjects'],
  },
  {
    kind: 'alert',
    label: 'Alerts',
    chip: 'Alerts',
    source: 'Alerts',
    prefix: 'a',
    prefixes: ['a', 'alert', 'alerts', 'trigger', 'triggers'],
  },
] as const;

const BY_KIND = new Map<ResourceKind, ResourceTypeDef>(RESOURCE_TYPES.map((t) => [t.kind, t]));

const BY_PREFIX = new Map<string, ResourceKind>(
  RESOURCE_TYPES.flatMap((t) => t.prefixes.map((p) => [p, t.kind] as [string, ResourceKind])),
);

export function resourceType(kind: ResourceKind): ResourceTypeDef {
  const def = BY_KIND.get(kind);
  if (!def) throw new Error(`unknown resource kind: ${kind}`);
  return def;
}

/** One-line help shown in the palette's empty state. */
export const PREFIX_HELP: readonly string[] = RESOURCE_TYPES.map(
  (t) => `${t.prefix}: ${t.chip.toLowerCase()}`,
);

/* -------------------------------------------------------------------------- *
 * Query parsing
 * -------------------------------------------------------------------------- */

/** Minimum term length before an unfiltered resource search is issued. */
export const MIN_QUERY_LENGTH = 2;
/** With an explicit type prefix a single character is enough. */
export const MIN_FILTERED_QUERY_LENGTH = 1;

export interface ParsedPaletteQuery {
  /** Resource type the user narrowed to, or null for "everything". */
  kind: ResourceKind | null;
  /** The prefix exactly as typed (lowercased), or null when there was none. */
  prefix: string | null;
  /** The search term with the prefix stripped. */
  term: string;
  /** True when `term` is long enough to hit the backends. */
  searchable: boolean;
}

const PREFIX_RE = /^([A-Za-z]+)\s*:\s*([\s\S]*)$/;

/**
 * Split `"cg: billing"` into `{ kind: 'group', term: 'billing' }`. An unknown
 * prefix is *not* stripped — `foo: bar` searches for the literal `foo: bar`, so a
 * topic name containing a colon still works.
 */
export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const trimmed = raw.trim();
  const match = PREFIX_RE.exec(trimmed);
  if (match) {
    const kind = BY_PREFIX.get(match[1].toLowerCase());
    if (kind) {
      const term = match[2].trim();
      return {
        kind,
        prefix: match[1].toLowerCase(),
        term,
        searchable: term.length >= MIN_FILTERED_QUERY_LENGTH,
      };
    }
  }
  return {
    kind: null,
    prefix: null,
    term: trimmed,
    searchable: trimmed.length >= MIN_QUERY_LENGTH,
  };
}

/** Rewrite the raw input so it targets `kind` (null clears the filter). */
export function applyKindFilter(raw: string, kind: ResourceKind | null): string {
  const { term } = parsePaletteQuery(raw);
  return kind ? `${resourceType(kind).prefix}: ${term}` : term;
}

/** Case-insensitive "contains" over a set of fields; an empty term matches all. */
export function matchesTerm(term: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => Boolean(f) && f!.toLowerCase().includes(needle));
}

/* -------------------------------------------------------------------------- *
 * Results
 * -------------------------------------------------------------------------- */

export interface PaletteResult {
  kind: ResourceKind;
  /** Unique, stable cmdk value. */
  id: string;
  title: string;
  /** Route that lands on the exact resource. */
  href: string;
  /** Right-aligned hint (partition count, lag, state, …). */
  meta?: string;
}

const seg = (value: string) => encodeURIComponent(value);

export function toTopicResults(items: TopicSummary[], clusterId: string): PaletteResult[] {
  return items.map((topic) => ({
    kind: 'topic',
    id: `topic:${topic.name}`,
    title: topic.name,
    href: `/c/${seg(clusterId)}/topics/${seg(topic.name)}`,
    meta: `${topic.partitions}p · rf${topic.replicationFactor}`,
  }));
}

export function toGroupResults(items: ConsumerGroupSummary[], clusterId: string): PaletteResult[] {
  return items.map((group) => ({
    kind: 'group',
    id: `group:${group.groupId}`,
    title: group.groupId,
    href: `/c/${seg(clusterId)}/consumers/${seg(group.groupId)}`,
    meta: `lag ${group.totalLag}`,
  }));
}

/** A connector always belongs to a named Connect cluster (`kc`). */
export interface ConnectorHit {
  kc: string;
  connector: Connector;
}

export function toConnectorResults(items: ConnectorHit[], clusterId: string): PaletteResult[] {
  return items.map(({ kc, connector }) => ({
    kind: 'connector',
    id: `connector:${kc}/${connector.name}`,
    title: connector.name,
    href: `/c/${seg(clusterId)}/connect/${seg(kc)}/connectors/${seg(connector.name)}`,
    meta: `${kc} · ${connector.state}`,
  }));
}

/** A Flink job always belongs to a named Flink cluster (`fc`). */
export interface FlinkJobHit {
  fc: string;
  job: FlinkJob;
}

export function toFlinkJobResults(items: FlinkJobHit[], clusterId: string): PaletteResult[] {
  return items.map(({ fc, job }) => ({
    kind: 'flinkJob',
    id: `flink:${fc}/${job.jid}`,
    title: job.name || job.jid,
    href: `/c/${seg(clusterId)}/flink/${seg(fc)}/jobs/${seg(job.jid)}`,
    meta: `${fc} · ${job.state}`,
  }));
}

export function toSchemaResults(items: SchemaSubjectSummary[], clusterId: string): PaletteResult[] {
  return items.map((subject) => ({
    kind: 'schema',
    id: `schema:${subject.subject}`,
    title: subject.subject,
    href: `/c/${seg(clusterId)}/schemas/${seg(subject.subject)}`,
    meta: `v${subject.latestVersion} · ${subject.schemaType}`,
  }));
}

/** Alert triggers are global, so the route is not cluster-scoped. */
export function toAlertResults(items: AlertTrigger[]): PaletteResult[] {
  return items.map((trigger) => ({
    kind: 'alert',
    id: `alert:${trigger.id}`,
    title: trigger.name,
    href: `/alerts/triggers/${seg(trigger.id)}`,
    meta: `${trigger.severity}${trigger.enabled ? '' : ' · disabled'}`,
  }));
}

/* -------------------------------------------------------------------------- *
 * Source status + merging
 * -------------------------------------------------------------------------- */

export type SourceStatus =
  /** Not queried (no cluster, filtered out, term too short). */
  | 'idle'
  /** First load in flight. */
  | 'loading'
  /** Answered — `results` is authoritative, empty means "no matches". */
  | 'ready'
  /** The backend errored: results are unknown, not empty. */
  | 'unavailable';

export interface PaletteSourceInput {
  kind: ResourceKind;
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  results: PaletteResult[];
}

export interface PaletteSourceGroup {
  kind: ResourceKind;
  label: string;
  status: SourceStatus;
  results: PaletteResult[];
  /** Row copy for an unavailable source, else null. */
  message: string | null;
  /** Underlying error text (tooltip), else null. */
  detail: string | null;
}

export const DEFAULT_RESULT_LIMIT = 6;

export function deriveSourceStatus(input: {
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
}): SourceStatus {
  if (!input.enabled) return 'idle';
  if (input.isError) return 'unavailable';
  if (input.isLoading) return 'loading';
  return 'ready';
}

/** Best-effort human text for whatever a query rejected with. */
export function errorDetail(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message || null;
  if (typeof error === 'string') return error || null;
  return null;
}

export interface BuildOptions {
  /** Restrict to a single resource type (from the `t:`-style prefix). */
  kind?: ResourceKind | null;
  /** Max rows per source. */
  limit?: number;
}

/**
 * Turn raw per-source query state into render-ready groups: filtered by the active
 * type, limited, and with results dropped for every non-`ready` source so stale or
 * unknown data is never presented as an answer.
 */
export function buildSourceGroups(
  sources: PaletteSourceInput[],
  { kind = null, limit = DEFAULT_RESULT_LIMIT }: BuildOptions = {},
): PaletteSourceGroup[] {
  return sources
    .filter((s) => kind === null || s.kind === kind)
    .map((s) => {
      const def = resourceType(s.kind);
      const status = deriveSourceStatus(s);
      return {
        kind: s.kind,
        label: def.label,
        status,
        results: status === 'ready' ? s.results.slice(0, Math.max(0, limit)) : [],
        message: status === 'unavailable' ? `${def.source} unavailable — press to retry` : null,
        detail: status === 'unavailable' ? errorDetail(s.error) : null,
      };
    });
}

/** A group is worth rendering when it has matches or needs a retry row. */
export function isGroupVisible(group: PaletteSourceGroup): boolean {
  return group.status === 'unavailable' || group.results.length > 0;
}

export type PaletteSearchState =
  /** Nothing searched yet. */
  | 'idle'
  /** Every source still loading, nothing to show. */
  | 'searching'
  /** Everything answered, nothing matched. */
  | 'empty'
  /** Some sources answered with matches, others are down. */
  | 'partial'
  /** Matches from every reachable source. */
  | 'results'
  /** No matches *and* at least one source is down — "empty" would be a lie. */
  | 'unavailable';

export interface PaletteSummary {
  state: PaletteSearchState;
  /** Total rendered results across all groups. */
  total: number;
  /** Groups whose source errored. */
  unavailable: PaletteSourceGroup[];
  loading: boolean;
  /** Status line copy ('' when there is nothing worth saying). */
  message: string;
}

/**
 * Distinguish "no matches" from "we could not look". `searched` is false before the
 * user typed enough characters.
 */
export function summarizePaletteSources(
  groups: PaletteSourceGroup[],
  { searched }: { searched: boolean },
): PaletteSummary {
  const unavailable = groups.filter((g) => g.status === 'unavailable');
  const loading = groups.some((g) => g.status === 'loading');
  const total = groups.reduce((sum, g) => sum + g.results.length, 0);
  const names = unavailable.map((g) => resourceType(g.kind).source).join(', ');

  if (!searched) return { state: 'idle', total, unavailable, loading, message: '' };
  if (total > 0) {
    return unavailable.length > 0
      ? {
          state: 'partial',
          total,
          unavailable,
          loading,
          message: `Partial results — ${names} could not be searched.`,
        }
      : { state: 'results', total, unavailable, loading, message: '' };
  }
  if (unavailable.length > 0) {
    return {
      state: 'unavailable',
      total,
      unavailable,
      loading,
      message: `No results to show — ${names} could not be searched.`,
    };
  }
  if (loading) return { state: 'searching', total, unavailable, loading, message: 'Searching…' };
  return { state: 'empty', total, unavailable, loading, message: 'No matching resources.' };
}

/* -------------------------------------------------------------------------- *
 * Fan-out helper
 * -------------------------------------------------------------------------- */

/**
 * Flatten `Promise.allSettled` results from a fan-out (one request per Connect /
 * Flink cluster). Partially reachable fan-outs return what they got; a fan-out
 * where *every* branch failed throws, so the source is reported as unavailable.
 */
export function flattenSettled<T>(settled: PromiseSettledResult<T[]>[]): T[] {
  if (settled.length === 0) return [];
  const out: T[] = [];
  let fulfilled = 0;
  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      fulfilled += 1;
      out.push(...entry.value);
    }
  }
  if (fulfilled === 0) {
    const first = (settled[0] as PromiseRejectedResult).reason;
    throw first instanceof Error ? first : new Error(String(first));
  }
  return out;
}
