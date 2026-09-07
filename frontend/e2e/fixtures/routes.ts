/**
 * Default `/api/v1` route table for the e2e suite.
 *
 * Registered once per test; individual tests override any entry by calling `api.on(...)`
 * again (later registrations win). Everything here describes a healthy deployment — see
 * `data.ts` for the payloads and the specs for the incident overrides.
 */
import type { Message, MessagesResponse } from '../../src/api/types';
import { type ApiMock, sseBody } from './api-mock';
import * as data from './data';

/** Two records with JSON values, so field columns and the detail drawer have something real. */
export const sampleMessages: Message[] = [
  {
    partition: 0,
    offset: 41_001,
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 0),
    timestampType: 'CreateTime',
    key: 'ord-1001',
    keyFormat: 'string',
    value: { orderId: 'ord-1001', status: 'PLACED', amount: 42.5 },
    valueFormat: 'json',
    headers: { source: 'checkout' },
    keySchemaId: null,
    valueSchemaId: 11,
    sizeBytes: 184,
  },
  {
    partition: 1,
    offset: 39_880,
    timestamp: Date.UTC(2026, 0, 1, 12, 0, 5),
    timestampType: 'CreateTime',
    key: 'ord-1002',
    keyFormat: 'string',
    value: { orderId: 'ord-1002', status: 'ERROR', amount: 19.99 },
    valueFormat: 'json',
    headers: { source: 'checkout' },
    keySchemaId: null,
    valueSchemaId: 11,
    sizeBytes: 191,
  },
];

/** A complete bounded read: two records, a progress tick, then `end`. */
export function messagesStream(messages: Message[] = sampleMessages): string {
  return sseBody([
    ...messages.map((m) => ({ event: 'message', data: m })),
    {
      event: 'progress',
      data: { scanned: messages.length, matched: messages.length, done: false },
    },
    { event: 'end', data: { scanned: messages.length, matched: messages.length, done: true } },
  ]);
}

export function registerDefaultRoutes(api: ApiMock): void {
  /* ------------------------------- system ------------------------------- */
  api.on('GET /info', { json: data.info });
  api.on('GET /auth/me', { json: data.ADMIN_USER });
  api.on('POST /auth/logout', { status: 204, body: '' });

  /* ------------------------------ clusters ------------------------------ */
  api.on('GET /clusters', { json: data.clusters });
  api.on('GET /clusters/:cluster', (ctx) => ({ json: data.clusterDetail(ctx.params.cluster) }));
  api.on('GET /clusters/:cluster/health', { json: data.clusterHealth });
  api.on('GET /clusters/:cluster/overview/metrics', { json: data.overviewMetrics });
  api.on('GET /clusters/:cluster/kraft/quorum', { json: data.kraftQuorum });
  api.on('GET /clusters/:cluster/configs', { json: [] });
  api.on('GET /clusters/:cluster/replication', { json: [] });

  /* ----------------------------- partitions ----------------------------- */
  api.on('GET /clusters/:cluster/partitions/unhealthy', { json: data.healthyPartitions });
  api.on('GET /clusters/:cluster/partitions/capabilities', {
    json: { clientVersion: '2.6.0', electLeaders: true, reassign: true, listReassignments: true },
  });
  api.on('GET /clusters/:cluster/partitions/reassignments', {
    json: { supported: true, reason: null, items: [], throttled: false },
  });

  /* ------------------------------- brokers ------------------------------ */
  api.on('GET /clusters/:cluster/brokers', { json: [] });

  /* ------------------------------- topics ------------------------------- */
  api.on('GET /clusters/:cluster/topics', (ctx) => ({ json: data.topicsPage(ctx.query) }));
  api.on('GET /clusters/:cluster/topics/:topic', (ctx) => ({
    json: data.topicDetail(ctx.params.topic),
  }));
  api.on('GET /clusters/:cluster/topics/:topic/configs', { json: [] });
  api.on('GET /clusters/:cluster/topics/:topic/consumers', { json: [] });
  api.on('GET /clusters/:cluster/topics/:topic/schema', {
    json: { key: null, value: null, strategy: 'TopicNameStrategy' },
  });
  api.on('GET /clusters/:cluster/topics/:topic/metrics', {
    json: data.series(['bytesIn', 'bytesOut', 'messagesIn']),
  });

  /**
   * The message browser reads this over SSE (`stream=true`) via fetch + ReadableStream, so a
   * plain `text/event-stream` body is a faithful mock: the client parses the events, sees
   * `end`, and settles into the "Stopped" state. `stream=false` is the export/preview path.
   */
  api.on('GET /clusters/:cluster/topics/:topic/messages', (ctx) => {
    if (ctx.query.get('stream') === 'true') {
      return { contentType: 'text/event-stream', body: messagesStream() };
    }
    return {
      json: { items: sampleMessages, scanned: sampleMessages.length } satisfies MessagesResponse,
    };
  });

  /* --------------------------- consumer groups -------------------------- */
  api.on('GET /clusters/:cluster/consumer-groups', (ctx) => ({
    json: data.consumerGroupList(ctx.query),
  }));
  api.on('GET /clusters/:cluster/consumer-groups/:group', { json: data.laggingGroupDetail });
  api.on('GET /clusters/:cluster/consumer-groups/:group/lag-history', {
    json: data.series(['lag']),
  });
  api.on('DELETE /clusters/:cluster/consumer-groups/:group', { status: 204, body: '' });
  api.on('GET /clusters/:cluster/share-groups', { json: { supported: false } });

  /* ------------------------------- connect ------------------------------ */
  api.on('GET /clusters/:cluster/connect', { json: data.connectClusters });
  api.on('GET /clusters/:cluster/connect/:kc/connectors', { json: data.connectors });

  /* -------------------------------- flink ------------------------------- */
  api.on('GET /clusters/:cluster/flink', { json: data.flinkClusters });
  api.on('GET /clusters/:cluster/flink/:fc/jobs', { json: data.flinkJobs });

  /* ------------------------------- schemas ------------------------------ */
  api.on('GET /clusters/:cluster/schemas/subjects', (ctx) => ({
    json: data.schemaSubjectList(ctx.query),
  }));
  api.on('GET /clusters/:cluster/schemas/info', {
    json: {
      type: 'confluent',
      url: 'http://schema-registry:8081',
      mode: 'READWRITE',
      version: '7.6',
    },
  });

  /* ------------------------------- lineage ------------------------------ */
  api.on('GET /clusters/:cluster/lineage/graph', { json: data.lineageGraph });
  api.on('GET /clusters/:cluster/lineage/search', (ctx) => ({
    json: { query: ctx.query.get('q') ?? '', results: [] },
  }));
  api.on('GET /clusters/:cluster/lineage/namespaces', { json: [] });

  /* -------------------------------- alerts ------------------------------ */
  api.on('GET /alerts/summary', { json: data.alertSummary });
  api.on('GET /alerts/triggers', { json: data.alertTriggers });
  api.on('GET /alerts/actions', { json: [] });
  api.on('GET /alerts/metrics', { json: {} });
  api.on('GET /alerts/history', { json: { items: [], page: 1, perPage: 25, total: 0 } });

  /* ------------------------- connection tester -------------------------- */
  api.on('POST /system/connection-test', { json: data.connectionTestAllOk });
  api.on('POST /system/connection-config', { json: data.connectionTestAllOk.config });

  /* -------------------------------- audit ------------------------------- */
  api.on('GET /audit', { json: { items: [], page: 1, perPage: 50, total: 0 } });
}
