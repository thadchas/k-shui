import { describe, expect, it } from 'vitest';
import { maskConfigValue, shortClass, taskCounts } from './connectUtils';

describe('maskConfigValue', () => {
  it.each([
    'connection.password',
    'sasl.jaas.config.secret',
    'aws.access.key.id.token',
    'ssl.keystore.location',
    'ssl.truststore.password',
    'database.credentials',
    'private.key',
  ])('masks %s', (name) => {
    expect(maskConfigValue(name, 'hunter2')).toBe('••••••••');
  });
  it.each(['topics', 'tasks.max', 'connector.class', 'key.converter', 'keyspace'])(
    'leaves %s untouched',
    (name) => {
      expect(maskConfigValue(name, 'plain')).toBe('plain');
    },
  );
});

describe('shortClass / taskCounts', () => {
  it('shortens FQCNs', () => {
    expect(shortClass('org.apache.kafka.connect.file.FileStreamSourceConnector')).toBe(
      'FileStreamSourceConnector',
    );
  });
  it('counts task states', () => {
    const counts = taskCounts([
      { id: 0, state: 'RUNNING', workerId: 'w', trace: null },
      { id: 1, state: 'FAILED', workerId: 'w', trace: 'boom' },
    ] as never);
    expect(counts.failed).toBe(1);
    expect(counts.running).toBe(1);
  });
});
