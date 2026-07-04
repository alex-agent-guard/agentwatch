import { describe, expect, it } from 'vitest';

import {
  createDisabledCloudConfig,
  isValidCloudEndpoint,
  parseCloudConfig,
} from '../../../src/config/cloud-config.js';

const reader = {
  readOptionalBoolean: (raw: Record<string, unknown>, key: string) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : undefined,
  readOptionalString: (raw: Record<string, unknown>, key: string) =>
    typeof raw[key] === 'string' ? (raw[key] as string) : undefined,
  readOptionalPositiveNumber: (raw: Record<string, unknown>, key: string) => {
    const value = raw[key];
    return typeof value === 'number' && value > 0 ? value : undefined;
  },
  readRecord: (
    raw: Record<string, unknown>,
    key: string,
    fallback: Record<string, unknown>,
  ) => {
    const value = raw[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return fallback;
  },
};

describe('cloud-config', () => {
  it('isValidCloudEndpoint accepts https URLs', () => {
    expect(isValidCloudEndpoint('https://api.agentwatch.io/v1')).toBe(true);
  });

  it('isValidCloudEndpoint rejects invalid URLs', () => {
    expect(isValidCloudEndpoint('not-a-url')).toBe(false);
    expect(isValidCloudEndpoint('')).toBe(false);
  });

  it('parseCloudConfig returns disabled defaults when cloud node is empty', () => {
    const config = parseCloudConfig({}, {}, reader);
    expect(config.enabled).toBe(false);
    expect(config.endpoint).toContain('https://');
    expect(config.apiKey).toBe('');
  });

  it('parseCloudConfig disables upload when enabled but endpoint missing', () => {
    const config = parseCloudConfig(
      { enabled: true, apiKey: 'aw_key' },
      {},
      reader,
    );
    expect(config.enabled).toBe(false);
  });

  it('parseCloudConfig disables upload when apiKey is empty', () => {
    const config = parseCloudConfig(
      {
        enabled: true,
        endpoint: 'https://api.agentwatch.test/v1',
        apiKey: '',
      },
      {},
      reader,
    );
    expect(config.enabled).toBe(false);
  });

  it('parseCloudConfig disables upload when endpoint format is invalid', () => {
    const config = parseCloudConfig(
      {
        enabled: true,
        endpoint: 'ftp://bad.host/v1',
        apiKey: 'aw_key',
      },
      {},
      reader,
    );
    expect(config.enabled).toBe(false);
  });

  it('parseCloudConfig returns enabled config when all fields are valid', () => {
    const config = parseCloudConfig(
      {
        enabled: true,
        endpoint: 'https://api.agentwatch.io/v1',
        apiKey: 'aw_api_xxx',
        batch: { batchSize: 50, flushIntervalMs: 3000 },
      },
      {},
      reader,
    );

    expect(config).toEqual({
      enabled: true,
      endpoint: 'https://api.agentwatch.io/v1',
      apiKey: 'aw_api_xxx',
      batch: { batchSize: 50, flushIntervalMs: 3000 },
    });
  });

  it('parseCloudConfig prefers AGENTWATCH_API_KEY env over yaml apiKey', () => {
    const config = parseCloudConfig(
      {
        enabled: true,
        endpoint: 'https://api.agentwatch.io/v1',
        apiKey: 'yaml-key',
      },
      { AGENTWATCH_API_KEY: 'env-key' },
      reader,
    );

    expect(config.enabled).toBe(true);
    expect(config.apiKey).toBe('env-key');
  });

  it('createDisabledCloudConfig always sets enabled=false', () => {
    expect(createDisabledCloudConfig().enabled).toBe(false);
  });
});
