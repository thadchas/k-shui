/**
 * Pure helpers for the guided "Test a connection" flow.
 *
 * The form is deliberately flat (one field per thing an operator types); this module turns
 * it into the nested `POST /system/connection-test` body, and maps result statuses onto the
 * three questions a first-time user actually has: is it the network, the credentials, or
 * the permissions?
 */
import { z } from 'zod';
import type {
  ConnectionComponentResult,
  ConnectionEnvVar,
  ConnectionFailureCategory,
  ConnectionStatus,
  ConnectionTestRequest,
} from '@/api/types';
import type { KeyValuePair } from '@/components/ui/key-value-editor';

export const CLUSTER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const optionalUrl = z
  .string()
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Must start with http:// or https://');

export const connectionSchema = z.object({
  clusterId: z
    .string()
    .min(1, 'A cluster id is required')
    .max(128)
    .regex(
      CLUSTER_ID_RE,
      'Letters, digits, dot, underscore and hyphen; must start with a letter or digit',
    ),
  clusterName: z.string().max(256),
  bootstrapServers: z.string().min(1, 'At least one host:port is required'),
  securityProtocol: z.enum(['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL']),
  saslMechanism: z.enum(['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512', 'GSSAPI', 'OAUTHBEARER']),
  saslUsername: z.string(),
  saslPassword: z.string(),
  schemaRegistryUrl: optionalUrl,
  schemaRegistryType: z.enum(['confluent', 'apicurio', 'karapace']),
  schemaRegistryUsername: z.string(),
  schemaRegistryPassword: z.string(),
  connectUrl: optionalUrl,
  connectUsername: z.string(),
  connectPassword: z.string(),
  ksqlUrl: optionalUrl,
  ksqlUsername: z.string(),
  ksqlPassword: z.string(),
  flinkUrl: optionalUrl,
  flinkSqlGatewayUrl: optionalUrl,
  prometheusUrl: optionalUrl,
  prometheusUsername: z.string(),
  prometheusPassword: z.string(),
});

export type ConnectionFormValues = z.infer<typeof connectionSchema>;

export const DEFAULT_FORM_VALUES: ConnectionFormValues = {
  clusterId: 'local',
  clusterName: '',
  bootstrapServers: '',
  securityProtocol: 'PLAINTEXT',
  saslMechanism: 'PLAIN',
  saslUsername: '',
  saslPassword: '',
  schemaRegistryUrl: '',
  schemaRegistryType: 'confluent',
  schemaRegistryUsername: '',
  schemaRegistryPassword: '',
  connectUrl: '',
  connectUsername: '',
  connectPassword: '',
  ksqlUrl: '',
  ksqlUsername: '',
  ksqlPassword: '',
  flinkUrl: '',
  flinkSqlGatewayUrl: '',
  prometheusUrl: '',
  prometheusUsername: '',
  prometheusPassword: '',
};

/** `true` when the protocol carries SASL credentials (so the form shows them). */
export function usesSasl(protocol: ConnectionFormValues['securityProtocol']): boolean {
  return protocol.startsWith('SASL');
}

function auth(username: string, password: string) {
  const u = username.trim();
  const p = password;
  if (!u && !p) return undefined;
  return { ...(u ? { username: u } : {}), ...(p ? { password: p } : {}) };
}

/** Derive a url-safe cluster id from a display name (`Prod EU` → `prod-eu`). */
export function suggestClusterId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'local';
}

/** Flat form values → the nested request body. Empty fields are omitted entirely. */
export function toConnectionRequest(
  values: ConnectionFormValues,
  extraProperties: KeyValuePair[] = [],
  timeoutSeconds = 5,
): ConnectionTestRequest {
  const properties: Record<string, string> = {};
  if (values.securityProtocol !== 'PLAINTEXT') {
    properties['security.protocol'] = values.securityProtocol;
  }
  if (usesSasl(values.securityProtocol)) {
    properties['sasl.mechanism'] = values.saslMechanism;
    if (values.saslUsername.trim()) properties['sasl.username'] = values.saslUsername.trim();
    if (values.saslPassword) properties['sasl.password'] = values.saslPassword;
  }
  for (const pair of extraProperties) {
    const key = pair.key.trim();
    if (key && pair.value !== '') properties[key] = pair.value;
  }

  const request: ConnectionTestRequest = {
    clusterId: values.clusterId.trim(),
    bootstrapServers: values.bootstrapServers.trim(),
    timeoutSeconds,
  };
  if (values.clusterName.trim()) request.clusterName = values.clusterName.trim();
  if (Object.keys(properties).length > 0) request.properties = properties;

  if (values.schemaRegistryUrl.trim()) {
    request.schemaRegistry = {
      url: values.schemaRegistryUrl.trim(),
      type: values.schemaRegistryType,
      auth: auth(values.schemaRegistryUsername, values.schemaRegistryPassword),
    };
  }
  if (values.connectUrl.trim()) {
    request.connect = {
      name: `${values.clusterId.trim()}-connect`,
      url: values.connectUrl.trim(),
      auth: auth(values.connectUsername, values.connectPassword),
    };
  }
  if (values.ksqlUrl.trim()) {
    request.ksqldb = {
      name: `${values.clusterId.trim()}-ksqldb`,
      url: values.ksqlUrl.trim(),
      auth: auth(values.ksqlUsername, values.ksqlPassword),
    };
  }
  if (values.flinkUrl.trim()) {
    request.flink = {
      name: `${values.clusterId.trim()}-flink`,
      url: values.flinkUrl.trim(),
      ...(values.flinkSqlGatewayUrl.trim()
        ? { sqlGatewayUrl: values.flinkSqlGatewayUrl.trim() }
        : {}),
    };
  }
  if (values.prometheusUrl.trim()) {
    request.prometheus = {
      url: values.prometheusUrl.trim(),
      auth: auth(values.prometheusUsername, values.prometheusPassword),
    };
  }
  return request;
}

export interface CategoryMeta {
  /** What kind of problem this is, in the user's words. */
  label: string;
  /** What to change to fix it. */
  hint: string;
  badge: 'success' | 'warning' | 'danger' | 'secondary';
}

export const CATEGORY_META: Record<ConnectionFailureCategory, CategoryMeta> = {
  none: { label: 'Connected', hint: '', badge: 'success' },
  connectivity: {
    label: 'Connectivity',
    hint: 'The address could not be reached. Check host, port, DNS and firewall rules.',
    badge: 'danger',
  },
  credentials: {
    label: 'Credentials',
    hint: 'Reached, but the credentials were rejected. Check the user, password, token or mechanism.',
    badge: 'warning',
  },
  permissions: {
    label: 'Permissions',
    hint: 'Authenticated, but not allowed to read. Grant this principal describe/read access.',
    badge: 'warning',
  },
  configuration: {
    label: 'Configuration',
    hint: 'Reached something else than the expected API. Check the URL path and client properties.',
    badge: 'danger',
  },
};

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  ok: 'OK',
  unreachable: 'Unreachable',
  auth_failed: 'Auth failed',
  permission_denied: 'Permission denied',
  invalid: 'Invalid',
};

/** One-line summary of the facts a probe discovered, for the result row. */
export function summarizeMetadata(result: ConnectionComponentResult): string {
  const meta = result.metadata ?? {};
  const parts: string[] = [];
  const push = (key: string, label: string) => {
    const value = meta[key];
    if (value !== undefined && value !== null && value !== '')
      parts.push(`${label} ${String(value)}`);
  };
  push('brokerCount', 'brokers');
  push('topicCount', 'topics');
  push('clusterId', 'cluster');
  push('version', 'v');
  push('kafkaClusterId', 'kafka');
  push('subjectCount', 'subjects');
  push('taskmanagers', 'taskmanagers');
  push('slotsTotal', 'slots');
  return parts.join(' · ');
}

/** Shell snippet for the env vars the generated YAML expects (values are left blank). */
export function envExportSnippet(envVars: ConnectionEnvVar[]): string {
  if (envVars.length === 0) return '';
  return envVars.map((v) => `export ${v.name}=...   # ${v.description}`).join('\n');
}

/** Suggested filename for the downloaded fragment. */
export function configFilename(clusterId: string): string {
  return `k-shui-${suggestClusterId(clusterId)}.yaml`;
}
