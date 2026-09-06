import { describe, expect, it } from 'vitest';
import type { ConnectionComponentResult } from '@/api/types';
import {
  CATEGORY_META,
  DEFAULT_FORM_VALUES,
  configFilename,
  connectionSchema,
  envExportSnippet,
  suggestClusterId,
  summarizeMetadata,
  toConnectionRequest,
  usesSasl,
  type ConnectionFormValues,
} from './connectionTester';

const values = (overrides: Partial<ConnectionFormValues> = {}): ConnectionFormValues => ({
  ...DEFAULT_FORM_VALUES,
  bootstrapServers: 'broker-1:9092',
  ...overrides,
});

describe('toConnectionRequest', () => {
  it('sends only the bootstrap servers for a plaintext cluster', () => {
    const request = toConnectionRequest(values());
    expect(request).toEqual({
      clusterId: 'local',
      bootstrapServers: 'broker-1:9092',
      timeoutSeconds: 5,
    });
    expect(request.properties).toBeUndefined();
  });

  it('trims whitespace and carries the display name', () => {
    const request = toConnectionRequest(
      values({
        bootstrapServers: '  a:9092, b:9092 ',
        clusterName: ' Prod EU ',
        clusterId: ' prod ',
      }),
    );
    expect(request.bootstrapServers).toBe('a:9092, b:9092');
    expect(request.clusterName).toBe('Prod EU');
    expect(request.clusterId).toBe('prod');
  });

  it('maps SASL fields onto librdkafka properties', () => {
    const request = toConnectionRequest(
      values({
        securityProtocol: 'SASL_SSL',
        saslMechanism: 'SCRAM-SHA-512',
        saslUsername: ' svc ',
        saslPassword: 'pw',
      }),
    );
    expect(request.properties).toEqual({
      'security.protocol': 'SASL_SSL',
      'sasl.mechanism': 'SCRAM-SHA-512',
      'sasl.username': 'svc',
      'sasl.password': 'pw',
    });
  });

  it('omits the SASL mechanism when the protocol does not use SASL', () => {
    const request = toConnectionRequest(values({ securityProtocol: 'SSL', saslUsername: 'svc' }));
    expect(request.properties).toEqual({ 'security.protocol': 'SSL' });
  });

  it('merges extra properties and skips blank keys', () => {
    const request = toConnectionRequest(values(), [
      { key: ' ssl.ca.location ', value: '/etc/ca.pem' },
      { key: '', value: 'ignored' },
      { key: 'client.id', value: '' },
    ]);
    expect(request.properties).toEqual({ 'ssl.ca.location': '/etc/ca.pem' });
  });

  it('includes only the integrations whose URL was filled in', () => {
    const request = toConnectionRequest(
      values({ schemaRegistryUrl: 'http://sr:8081', schemaRegistryType: 'apicurio' }),
    );
    expect(request.schemaRegistry).toEqual({
      url: 'http://sr:8081',
      type: 'apicurio',
      auth: undefined,
    });
    expect(request.connect).toBeUndefined();
    expect(request.ksqldb).toBeUndefined();
    expect(request.flink).toBeUndefined();
    expect(request.prometheus).toBeUndefined();
  });

  it('attaches integration credentials only when given', () => {
    const request = toConnectionRequest(
      values({
        connectUrl: 'http://connect:8083',
        connectUsername: 'u',
        connectPassword: 'p',
        prometheusUrl: 'http://prom:9090',
      }),
    );
    expect(request.connect).toEqual({
      name: 'local-connect',
      url: 'http://connect:8083',
      auth: { username: 'u', password: 'p' },
    });
    expect(request.prometheus?.auth).toBeUndefined();
  });

  it('adds the Flink SQL gateway only when provided', () => {
    expect(toConnectionRequest(values({ flinkUrl: 'http://flink:8081' })).flink).toEqual({
      name: 'local-flink',
      url: 'http://flink:8081',
    });
    expect(
      toConnectionRequest(
        values({ flinkUrl: 'http://flink:8081', flinkSqlGatewayUrl: 'http://flink:8083' }),
      ).flink?.sqlGatewayUrl,
    ).toBe('http://flink:8083');
  });

  it('passes the timeout through', () => {
    expect(toConnectionRequest(values(), [], 10).timeoutSeconds).toBe(10);
  });
});

describe('connectionSchema', () => {
  it('requires bootstrap servers', () => {
    const result = connectionSchema.safeParse(values({ bootstrapServers: '' }));
    expect(result.success).toBe(false);
  });

  it.each(['bad id', 'has/slash', '-leading'])('rejects the cluster id %s', (clusterId) => {
    expect(connectionSchema.safeParse(values({ clusterId })).success).toBe(false);
  });

  it.each(['local', 'prod-eu', 'a.b_c-1'])('accepts the cluster id %s', (clusterId) => {
    expect(connectionSchema.safeParse(values({ clusterId })).success).toBe(true);
  });

  it('accepts an empty integration URL but rejects a malformed one', () => {
    expect(connectionSchema.safeParse(values({ connectUrl: '' })).success).toBe(true);
    expect(connectionSchema.safeParse(values({ connectUrl: 'connect:8083' })).success).toBe(false);
    expect(connectionSchema.safeParse(values({ connectUrl: 'https://connect' })).success).toBe(
      true,
    );
  });
});

describe('usesSasl / suggestClusterId / configFilename', () => {
  it.each([
    ['PLAINTEXT', false],
    ['SSL', false],
    ['SASL_SSL', true],
    ['SASL_PLAINTEXT', true],
  ] as const)('%s uses SASL: %s', (protocol, expected) => {
    expect(usesSasl(protocol)).toBe(expected);
  });

  it('slugifies a display name', () => {
    expect(suggestClusterId('Prod EU (kafka)')).toBe('prod-eu-kafka');
    expect(suggestClusterId('  ')).toBe('local');
  });

  it('names the download after the cluster', () => {
    expect(configFilename('Prod EU')).toBe('k-shui-prod-eu.yaml');
  });
});

describe('summarizeMetadata', () => {
  const result = (metadata: Record<string, unknown>): ConnectionComponentResult => ({
    component: 'kafka',
    label: 'Kafka',
    target: 'broker:9092',
    status: 'ok',
    category: 'none',
    latencyMs: 12,
    detail: '',
    metadata,
  });

  it('lists the discovered facts in a stable order', () => {
    expect(summarizeMetadata(result({ brokerCount: 3, clusterId: 'abc', topicCount: 7 }))).toBe(
      'brokers 3 · topics 7 · cluster abc',
    );
  });

  it('skips missing and empty values', () => {
    expect(summarizeMetadata(result({ version: null, subjectCount: 0 }))).toBe('subjects 0');
    expect(summarizeMetadata(result({}))).toBe('');
  });
});

describe('envExportSnippet / CATEGORY_META', () => {
  it('renders one export line per variable', () => {
    expect(
      envExportSnippet([
        {
          name: 'KSHUI_LOCAL_SASL_PASSWORD',
          component: 'kafka',
          description: 'Kafka client property.',
        },
      ]),
    ).toBe('export KSHUI_LOCAL_SASL_PASSWORD=...   # Kafka client property.');
    expect(envExportSnippet([])).toBe('');
  });

  it('gives every failure category an actionable hint', () => {
    for (const [category, meta] of Object.entries(CATEGORY_META)) {
      expect(meta.label).not.toBe('');
      if (category !== 'none') expect(meta.hint.length).toBeGreaterThan(10);
    }
  });
});
