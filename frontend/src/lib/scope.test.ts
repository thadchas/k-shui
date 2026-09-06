import { describe, expect, it } from 'vitest';
import {
  CLUSTER_SECTIONS,
  classifyRoute,
  clusterSwitchNotice,
  clusterSwitchPath,
  isGlobalRoute,
  matchResourceRoute,
  parseClusterPath,
  preservedSearch,
  sectionLabel,
} from './scope';

describe('classifyRoute', () => {
  it('marks /c/:cluster routes as cluster-scoped and reports the section', () => {
    expect(classifyRoute('/c/local/topics')).toEqual({
      kind: 'cluster',
      clusterId: 'local',
      section: 'topics',
    });
    expect(classifyRoute('/c/local/connect/kc1/connectors/sink')).toMatchObject({
      kind: 'cluster',
      section: 'connect',
    });
  });

  it('defaults the section to overview at the cluster root', () => {
    expect(classifyRoute('/c/local')).toEqual({
      kind: 'cluster',
      clusterId: 'local',
      section: 'overview',
    });
  });

  it('classifies Alerts, Audit, Clusters and app settings as global', () => {
    for (const path of ['/alerts', '/alerts/triggers/7', '/audit', '/clusters', '/settings', '/']) {
      expect(isGlobalRoute(path)).toBe(true);
      expect(classifyRoute(path).kind).toBe('global');
    }
  });

  it('decodes the cluster id', () => {
    expect(parseClusterPath('/c/prod%20east/topics')).toEqual({
      clusterId: 'prod east',
      rest: ['topics'],
    });
    expect(parseClusterPath('/alerts')).toBeNull();
  });

  it('derives cluster sections from the nav definition', () => {
    expect(CLUSTER_SECTIONS).toContain('topics');
    expect(CLUSTER_SECTIONS).toContain('share-groups');
    expect(CLUSTER_SECTIONS).toContain('overview');
    expect(CLUSTER_SECTIONS).not.toContain('alerts');
    expect(CLUSTER_SECTIONS).not.toContain('audit');
  });
});

describe('sectionLabel', () => {
  it('uses nav labels and falls back to a humanised segment', () => {
    expect(sectionLabel('share-groups')).toBe('Share groups');
    expect(sectionLabel('topics')).toBe('Topics');
    expect(sectionLabel('ksql')).toBe('ksqlDB');
    expect(sectionLabel('mystery-thing')).toBe('Mystery thing');
  });
});

describe('matchResourceRoute', () => {
  it('recognises each resource-detail route', () => {
    expect(matchResourceRoute('/c/local/topics/orders')).toEqual({
      clusterId: 'local',
      type: 'topic',
      name: 'orders',
      path: '/c/local/topics/orders',
    });
    expect(matchResourceRoute('/c/local/consumers/billing')).toMatchObject({
      type: 'consumer-group',
      name: 'billing',
    });
    expect(matchResourceRoute('/c/local/schemas/orders-value')).toMatchObject({
      type: 'schema',
      name: 'orders-value',
    });
    expect(matchResourceRoute('/c/local/brokers/1')).toMatchObject({ type: 'broker', name: '1' });
    expect(matchResourceRoute('/c/local/connect/kc1/connectors/s3-sink')).toMatchObject({
      type: 'connector',
      name: 's3-sink',
      path: '/c/local/connect/kc1/connectors/s3-sink',
    });
    expect(matchResourceRoute('/c/local/flink/fc1/jobs/abc123')).toMatchObject({
      type: 'flink-job',
      name: 'abc123',
    });
  });

  it('decodes resource names but keeps the encoded path for links', () => {
    const ref = matchResourceRoute('/c/local/topics/orders%2Fv1');
    expect(ref?.name).toBe('orders/v1');
    expect(ref?.path).toBe('/c/local/topics/orders%2Fv1');
  });

  it('ignores list, creation and non-resource routes', () => {
    expect(matchResourceRoute('/c/local/topics')).toBeNull();
    expect(matchResourceRoute('/c/local/topics/new')).toBeNull();
    expect(matchResourceRoute('/c/local/schemas/new')).toBeNull();
    expect(matchResourceRoute('/c/local/connect/kc1/connectors/new')).toBeNull();
    expect(matchResourceRoute('/c/local/metrics/broker-health')).toBeNull();
    expect(matchResourceRoute('/c/local/flink/fc1/taskmanagers')).toBeNull();
    expect(matchResourceRoute('/alerts/triggers/7')).toBeNull();
  });
});

describe('preservedSearch', () => {
  it('keeps only the investigation window params', () => {
    expect(preservedSearch('?range=6h&q=orders&page=3')).toBe('?range=6h');
    expect(preservedSearch('?from=1700000000&to=1700003600&tab=configs')).toBe(
      '?from=1700000000&to=1700003600',
    );
    expect(preservedSearch('?q=orders')).toBe('');
    expect(preservedSearch('')).toBe('');
    expect(preservedSearch(undefined)).toBe('');
  });
});

describe('clusterSwitchPath', () => {
  it('keeps the section when switching cluster', () => {
    expect(clusterSwitchPath('/c/a/topics', 'b')).toBe('/c/b/topics');
    expect(clusterSwitchPath('/c/a/share-groups', 'b')).toBe('/c/b/share-groups');
  });

  it('drops the resource context of a detail page down to its list page', () => {
    expect(clusterSwitchPath('/c/a/topics/orders', 'b')).toBe('/c/b/topics');
    expect(clusterSwitchPath('/c/a/consumers/billing', 'b')).toBe('/c/b/consumers');
    expect(clusterSwitchPath('/c/a/connect/kc1/connectors/s3-sink', 'b')).toBe('/c/b/connect');
    expect(clusterSwitchPath('/c/a/flink/fc1/jobs/abc123', 'b')).toBe('/c/b/flink');
  });

  it('lands global routes on the target cluster overview', () => {
    expect(clusterSwitchPath('/alerts', 'b')).toBe('/c/b/overview');
    expect(clusterSwitchPath('/audit', 'b')).toBe('/c/b/overview');
    expect(clusterSwitchPath('/clusters', 'b')).toBe('/c/b/overview');
    expect(clusterSwitchPath('/settings', 'b')).toBe('/c/b/overview');
  });

  it('falls back to overview for unknown sections and encodes the cluster id', () => {
    expect(clusterSwitchPath('/c/a/not-a-section', 'b')).toBe('/c/b/overview');
    expect(clusterSwitchPath('/c/a/topics', 'prod east')).toBe('/c/prod%20east/topics');
  });

  it('carries the time window but not view-local params', () => {
    expect(clusterSwitchPath('/c/a/metrics', 'b', '?range=6h&q=cpu')).toBe('/c/b/metrics?range=6h');
    expect(clusterSwitchPath('/c/a/topics/orders', 'b', '?range=1h&tab=messages')).toBe(
      '/c/b/topics?range=1h',
    );
  });
});

describe('clusterSwitchNotice', () => {
  it('describes what a switch drops on a resource-detail page', () => {
    expect(clusterSwitchNotice('/c/a/topics/orders')).toEqual({
      resource: {
        clusterId: 'a',
        type: 'topic',
        name: 'orders',
        path: '/c/a/topics/orders',
      },
      section: 'Topics',
    });
  });

  it('is silent when nothing is lost', () => {
    expect(clusterSwitchNotice('/c/a/topics')).toBeNull();
    expect(clusterSwitchNotice('/alerts')).toBeNull();
  });
});
