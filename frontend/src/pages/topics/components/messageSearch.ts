import type {
  FilterMode,
  FilterTarget,
  Message,
  MessageFormat,
  MessageMode,
  MessagesQuery,
} from '@/api/types';

/* -------------------------------------------------------------------------- */
/*                                query config                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the message browser needs to reproduce a query, and nothing else.
 * Saved searches persist exactly this shape — configuration, never payloads.
 */
export interface MessageQueryConfig {
  mode: MessageMode;
  /** Partition ids as strings; empty = all partitions. */
  partitions: string[];
  limit: number;
  /** Raw text of the scalar "from offset" input. */
  offset: string;
  /** Per-partition offset overrides for `mode=offset`, keyed by partition id. */
  perPartitionOffsets: Record<string, string>;
  timestamp: number | null;
  keyFormat: MessageFormat;
  valueFormat: MessageFormat;
  filter: string;
  filterMode: FilterMode;
  filterTarget: FilterTarget;
  hideTombstones: boolean;
  /** Dot paths of JSON value fields promoted to table columns. */
  fieldColumns: string[];
}

export const MESSAGE_MODES: MessageMode[] = ['latest', 'earliest', 'offset', 'timestamp', 'tail'];

export const MESSAGE_FORMATS: MessageFormat[] = [
  'auto',
  'string',
  'json',
  'avro',
  'protobuf',
  'jsonschema',
  'base64',
  'hex',
  'int',
  'long',
];

export const FILTER_MODES: FilterMode[] = ['contains', 'regex', 'jsonpath'];
export const FILTER_TARGETS: FilterTarget[] = ['any', 'key', 'value', 'header'];

export const MODE_OPTIONS: { label: string; value: MessageMode }[] = [
  { label: 'Latest', value: 'latest' },
  { label: 'Earliest', value: 'earliest' },
  { label: 'From offset', value: 'offset' },
  { label: 'From timestamp', value: 'timestamp' },
  { label: 'Live tail', value: 'tail' },
];

export const FORMAT_OPTIONS = MESSAGE_FORMATS.map((f) => ({ label: f, value: f }));

export const FILTER_MODE_OPTIONS: { label: string; value: FilterMode }[] = [
  { label: 'contains', value: 'contains' },
  { label: 'regex', value: 'regex' },
  { label: 'jsonpath', value: 'jsonpath' },
];

export const FILTER_TARGET_OPTIONS: { label: string; value: FilterTarget }[] = [
  { label: 'anywhere', value: 'any' },
  { label: 'key', value: 'key' },
  { label: 'value', value: 'value' },
  { label: 'header', value: 'header' },
];

export const LIMIT_CHOICES = [50, 100, 250, 500, 1000];

export const LIMIT_OPTIONS = LIMIT_CHOICES.map((n) => ({ label: String(n), value: String(n) }));

export const DEFAULT_LIMIT = 100;

export const DEFAULT_QUERY_CONFIG: MessageQueryConfig = {
  mode: 'latest',
  partitions: [],
  limit: DEFAULT_LIMIT,
  offset: '0',
  perPartitionOffsets: {},
  timestamp: null,
  keyFormat: 'auto',
  valueFormat: 'auto',
  filter: '',
  filterMode: 'contains',
  filterTarget: 'any',
  hideTombstones: false,
  fieldColumns: [],
};

export function clampInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Translate the browser's config into the wire query the stream/export endpoints take. */
export function buildMessagesQuery(
  config: MessageQueryConfig,
  scopedPartitionIds: number[],
): MessagesQuery {
  const scalarOffset = clampInt(config.offset, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  let startOffsets: { partition: number; offset: number }[] | undefined;
  if (config.mode === 'offset') {
    const overrides: { partition: number; offset: number }[] = [];
    for (const id of scopedPartitionIds) {
      const raw = config.perPartitionOffsets[String(id)];
      if (raw === undefined || raw === '') continue;
      const value = clampInt(raw, 0, Number.MAX_SAFE_INTEGER);
      if (value !== null && value !== scalarOffset)
        overrides.push({ partition: id, offset: value });
    }
    if (overrides.length > 0) startOffsets = overrides;
  }
  return {
    mode: config.mode,
    partitions: config.partitions.length > 0 ? config.partitions.map(Number) : undefined,
    offset: config.mode === 'offset' ? scalarOffset : undefined,
    startOffsets,
    timestamp: config.mode === 'timestamp' && config.timestamp ? config.timestamp : undefined,
    limit: config.limit,
    keyFormat: config.keyFormat,
    valueFormat: config.valueFormat,
    filter: config.filter || undefined,
    filterMode: config.filter ? config.filterMode : undefined,
    filterTarget: config.filter && config.filterTarget !== 'any' ? config.filterTarget : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*                            advanced disclosure                             */
/* -------------------------------------------------------------------------- */

export interface AdvancedSummary {
  /** True when at least one control hidden behind "Advanced" holds a non-default value. */
  active: boolean;
  count: number;
  /** Human descriptions of every non-default advanced control, for the badge tooltip. */
  items: string[];
}

/**
 * Which advanced (collapsed) controls carry non-default values. Drives the badge on the
 * Advanced disclosure so hidden configuration is never silent.
 */
export function advancedSummary(config: MessageQueryConfig): AdvancedSummary {
  const items: string[] = [];
  if (config.partitions.length > 0) {
    items.push(
      `Partitions: ${config.partitions.length} selected (${config.partitions.join(', ')})`,
    );
  }
  if (config.keyFormat !== DEFAULT_QUERY_CONFIG.keyFormat) {
    items.push(`Key encoding: ${config.keyFormat}`);
  }
  if (config.valueFormat !== DEFAULT_QUERY_CONFIG.valueFormat) {
    items.push(`Value encoding: ${config.valueFormat}`);
  }
  if (config.limit !== DEFAULT_QUERY_CONFIG.limit) {
    items.push(`Limit: ${config.limit}`);
  }
  if (config.filter !== '' && config.filterMode !== DEFAULT_QUERY_CONFIG.filterMode) {
    items.push(`Match mode: ${config.filterMode}`);
  }
  if (config.filter !== '' && config.filterTarget !== DEFAULT_QUERY_CONFIG.filterTarget) {
    items.push(`Search in: ${config.filterTarget}`);
  }
  const overrides =
    config.mode === 'offset'
      ? Object.values(config.perPartitionOffsets).filter((v) => v !== '').length
      : 0;
  if (overrides > 0) {
    items.push(`Per-partition offsets: ${overrides} overridden`);
  }
  return { active: items.length > 0, count: items.length, items };
}

/* -------------------------------------------------------------------------- */
/*                             consumption state                              */
/* -------------------------------------------------------------------------- */

export type ConsumptionStateId = 'live' | 'paused' | 'fetching' | 'stopped' | 'idle';

export interface ConsumptionStatus {
  id: ConsumptionStateId;
  /** Always rendered as text — never icon-only. */
  label: string;
  description: string;
}

export interface ConsumptionInput {
  hasRun: boolean;
  streaming: boolean;
  live: boolean;
  paused: boolean;
  done: boolean;
}

/** Explicit Live / Paused / Fetching / Stopped / Idle state for the status strip. */
export function consumptionStatus({
  hasRun,
  streaming,
  live,
  paused,
  done,
}: ConsumptionInput): ConsumptionStatus {
  if (!hasRun) {
    return { id: 'idle', label: 'Idle', description: 'No query running' };
  }
  if (streaming && live && paused) {
    return { id: 'paused', label: 'Paused', description: 'Stream held — new records buffered' };
  }
  if (streaming && live) {
    return { id: 'live', label: 'Live', description: 'Streaming new records' };
  }
  if (streaming) {
    return { id: 'fetching', label: 'Fetching', description: 'Reading records from the topic' };
  }
  return {
    id: 'stopped',
    label: 'Stopped',
    description: done ? 'Query finished — results held' : 'Stream stopped',
  };
}

/* -------------------------------------------------------------------------- */
/*                          JSON field path extraction                        */
/* -------------------------------------------------------------------------- */

/** `order.items[0].sku` → `['order', 'items', '0', 'sku']`. Returns [] for an unusable path. */
export function parseFieldPath(path: string): string[] {
  const trimmed = path.trim().replace(/^\$\.?/, '');
  if (trimmed === '') return [];
  const out: string[] = [];
  for (const chunk of trimmed.split('.')) {
    if (chunk === '') return [];
    const head = chunk.match(/^[^[\]]*/)?.[0] ?? '';
    if (head !== '') out.push(head);
    const rest = chunk.slice(head.length);
    if (rest === '') continue;
    const indices = rest.match(/\[[^[\]]*\]/g);
    if (!indices || indices.join('') !== rest) return [];
    for (const idx of indices) {
      const inner = idx.slice(1, -1).replace(/^['"]|['"]$/g, '');
      if (inner === '') return [];
      out.push(inner);
    }
  }
  return out;
}

function asContainer(payload: unknown): unknown {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed === '') return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined; // non-JSON payload: no fields to promote
    }
  }
  return payload;
}

/**
 * Read a dot path out of a decoded message value. Strings are parsed as JSON first, so a
 * payload the server handed back as text still yields fields. Missing paths, non-JSON
 * payloads and paths that walk through primitives all return `undefined`.
 */
export function extractFieldValue(payload: unknown, path: string): unknown {
  const segments = parseFieldPath(path);
  if (segments.length === 0) return undefined;
  let current = asContainer(payload);
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

/** Cell text for an extracted field: em dash when absent, JSON for containers. */
export function formatFieldValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const MAX_SUGGESTED_PATHS = 40;

/** Dot paths worth offering as columns, sampled from the loaded messages' values. */
export function suggestFieldPaths(
  messages: Pick<Message, 'value'>[],
  options: { maxDepth?: number; sample?: number; maxPaths?: number } = {},
): string[] {
  const maxDepth = options.maxDepth ?? 3;
  const sample = options.sample ?? 25;
  const maxPaths = options.maxPaths ?? MAX_SUGGESTED_PATHS;
  const seen = new Set<string>();

  const walk = (node: unknown, prefix: string, depth: number) => {
    if (seen.size >= maxPaths || depth > maxDepth || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length > 0) walk(node[0], `${prefix}[0]`, depth + 1);
      return;
    }
    if (typeof node !== 'object') {
      if (prefix !== '') seen.add(prefix);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (seen.size >= maxPaths) return;
      const next = prefix === '' ? key : `${prefix}.${key}`;
      if (child !== null && typeof child === 'object') walk(child, next, depth + 1);
      else seen.add(next);
    }
  };

  for (const message of messages.slice(0, sample)) {
    const container = asContainer(message.value);
    if (container === null || container === undefined || typeof container !== 'object') continue;
    walk(container, '', 1);
    if (seen.size >= maxPaths) break;
  }
  return [...seen];
}

/* -------------------------------------------------------------------------- */
/*                               saved searches                               */
/* -------------------------------------------------------------------------- */

export interface SavedSearch {
  id: string;
  name: string;
  savedAt: number;
  config: MessageQueryConfig;
}

export const SAVED_SEARCH_PREFIX = 'k-shui.messages.savedSearches';

export const MAX_SAVED_SEARCHES = 50;

export function savedSearchesKey(cluster: string, topic: string): string {
  return `${SAVED_SEARCH_PREFIX}.${encodeURIComponent(cluster)}.${encodeURIComponent(topic)}`;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Coerce untrusted storage content into a config. Only known keys survive, so a saved
 * search can never carry message payloads (or anything else) back into the app.
 */
export function sanitizeQueryConfig(raw: unknown): MessageQueryConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const partitions = Array.isArray(src.partitions)
    ? src.partitions
        .filter((p): p is string | number => typeof p === 'string' || typeof p === 'number')
        .map(String)
        .filter((p) => /^\d+$/.test(p))
    : [];
  const fieldColumns = Array.isArray(src.fieldColumns)
    ? src.fieldColumns
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter((p) => p !== '' && parseFieldPath(p).length > 0)
    : [];
  const perPartitionOffsets: Record<string, string> = {};
  if (src.perPartitionOffsets && typeof src.perPartitionOffsets === 'object') {
    for (const [k, v] of Object.entries(src.perPartitionOffsets as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) continue;
      if (typeof v === 'string' && /^\d*$/.test(v)) perPartitionOffsets[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) perPartitionOffsets[k] = String(v);
    }
  }
  const limit =
    typeof src.limit === 'number' && Number.isFinite(src.limit)
      ? Math.min(10_000, Math.max(1, Math.trunc(src.limit)))
      : DEFAULT_QUERY_CONFIG.limit;
  const offset =
    typeof src.offset === 'string' && /^\d*$/.test(src.offset)
      ? src.offset
      : typeof src.offset === 'number' && Number.isFinite(src.offset)
        ? String(Math.max(0, Math.trunc(src.offset)))
        : DEFAULT_QUERY_CONFIG.offset;
  return {
    mode: oneOf(src.mode, MESSAGE_MODES, DEFAULT_QUERY_CONFIG.mode),
    partitions: [...new Set(partitions)],
    limit,
    offset,
    perPartitionOffsets,
    timestamp:
      typeof src.timestamp === 'number' && Number.isFinite(src.timestamp) ? src.timestamp : null,
    keyFormat: oneOf(src.keyFormat, MESSAGE_FORMATS, DEFAULT_QUERY_CONFIG.keyFormat),
    valueFormat: oneOf(src.valueFormat, MESSAGE_FORMATS, DEFAULT_QUERY_CONFIG.valueFormat),
    filter: typeof src.filter === 'string' ? src.filter : '',
    filterMode: oneOf(src.filterMode, FILTER_MODES, DEFAULT_QUERY_CONFIG.filterMode),
    filterTarget: oneOf(src.filterTarget, FILTER_TARGETS, DEFAULT_QUERY_CONFIG.filterTarget),
    hideTombstones: src.hideTombstones === true,
    fieldColumns: [...new Set(fieldColumns)],
  };
}

let idCounter = 0;

export function createSavedSearch(name: string, config: MessageQueryConfig): SavedSearch {
  idCounter += 1;
  return {
    id: `s${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim().slice(0, 80) || 'Untitled search',
    savedAt: Date.now(),
    config: sanitizeQueryConfig(config),
  };
}

export function serializeSavedSearches(list: SavedSearch[]): string {
  const items = list.slice(0, MAX_SAVED_SEARCHES).map((s) => ({
    id: String(s.id),
    name: String(s.name).slice(0, 80),
    savedAt: typeof s.savedAt === 'number' && Number.isFinite(s.savedAt) ? s.savedAt : Date.now(),
    config: sanitizeQueryConfig(s.config),
  }));
  return JSON.stringify({ version: 1, items });
}

/** Tolerant of anything: corrupt JSON, wrong shapes and unknown extra keys all yield clean data. */
export function parseSavedSearches(raw: string | null | undefined): SavedSearch[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
      ? ((parsed as { items: unknown[] }).items as unknown[])
      : [];
  const out: SavedSearch[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const src = item as Record<string, unknown>;
    const name = typeof src.name === 'string' ? src.name.trim() : '';
    if (name === '') continue;
    out.push({
      id: typeof src.id === 'string' && src.id !== '' ? src.id : `${name}-${out.length}`,
      name: name.slice(0, 80),
      savedAt: typeof src.savedAt === 'number' && Number.isFinite(src.savedAt) ? src.savedAt : 0,
      config: sanitizeQueryConfig(src.config),
    });
    if (out.length >= MAX_SAVED_SEARCHES) break;
  }
  return out;
}

export function readSavedSearches(cluster: string, topic: string): SavedSearch[] {
  try {
    return parseSavedSearches(localStorage.getItem(savedSearchesKey(cluster, topic)));
  } catch {
    return [];
  }
}

export function writeSavedSearches(cluster: string, topic: string, list: SavedSearch[]): void {
  try {
    localStorage.setItem(savedSearchesKey(cluster, topic), serializeSavedSearches(list));
  } catch {
    /* storage unavailable or full */
  }
}
