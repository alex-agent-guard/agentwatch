/**
 * cloud 配置节点解析 — 容错降级，异常时自动禁用云端上报
 */
import { DEFAULT_CLOUD_CONFIG } from '@packages/shared/constants';

import type { CloudConfig } from '@packages/shared/types';

type CloudConfigReader = {
  readOptionalBoolean: (raw: Record<string, unknown>, key: string) => boolean | undefined;
  readOptionalString: (raw: Record<string, unknown>, key: string) => string | undefined;
  readOptionalPositiveNumber: (
    raw: Record<string, unknown>,
    key: string,
    fieldPath: string,
  ) => number | undefined;
  readRecord: (raw: Record<string, unknown>, key: string, fallback: Record<string, unknown>) => Record<string, unknown>;
};

/** 禁用态 cloud 配置 — 占位 endpoint/apiKey，enabled=false */
export function createDisabledCloudConfig(
  overrides?: Partial<Pick<CloudConfig, 'endpoint' | 'apiKey'>>,
): CloudConfig {
  return {
    enabled: false,
    endpoint: overrides?.endpoint ?? DEFAULT_CLOUD_CONFIG.endpoint,
    apiKey: overrides?.apiKey ?? DEFAULT_CLOUD_CONFIG.apiKey,
    batch: {
      batchSize: DEFAULT_CLOUD_CONFIG.batch.batchSize,
      flushIntervalMs: DEFAULT_CLOUD_CONFIG.batch.flushIntervalMs,
      maxRetries: DEFAULT_CLOUD_CONFIG.batch.maxRetries,
    },
  };
}

/** 校验云端 endpoint — 必须为 http(s) URL */
export function isValidCloudEndpoint(endpoint: string): boolean {
  try {
    const trimmed = endpoint.trim();
    if (trimmed.length === 0) {
      return false;
    }
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 解析 cloud YAML 节点 — 缺失/非法/apiKey 为空时返回 enabled=false，不抛错
 */
export function parseCloudConfig(
  raw: Record<string, unknown>,
  env: Record<string, string>,
  reader: CloudConfigReader,
): CloudConfig {
  try {
    if (Object.keys(raw).length === 0) {
      raw = {
        enabled: DEFAULT_CLOUD_CONFIG.enabled,
        endpoint: DEFAULT_CLOUD_CONFIG.endpoint,
      };
    }

    const enabled = reader.readOptionalBoolean(raw, 'enabled') ?? DEFAULT_CLOUD_CONFIG.enabled;
    const endpointExplicit = reader.readOptionalString(raw, 'endpoint');
    const endpointRaw = endpointExplicit ?? DEFAULT_CLOUD_CONFIG.endpoint;
    const apiKey = (env.AGENTWATCH_API_KEY ?? reader.readOptionalString(raw, 'apiKey') ?? '').trim();

    const batchRaw = reader.readRecord(raw, 'batch', {});
    const batchSize =
      reader.readOptionalPositiveNumber(batchRaw, 'batchSize', 'cloud.batch.batchSize') ??
      DEFAULT_CLOUD_CONFIG.batch.batchSize;
    const flushIntervalMs =
      reader.readOptionalPositiveNumber(batchRaw, 'flushIntervalMs', 'cloud.batch.flushIntervalMs') ??
      DEFAULT_CLOUD_CONFIG.batch.flushIntervalMs;
    const maxRetries = reader.readOptionalPositiveNumber(
      batchRaw,
      'maxRetries',
      'cloud.batch.maxRetries',
    );

    const batch = {
      batchSize,
      flushIntervalMs,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    };

    if (!enabled) {
      return {
        enabled: false,
        endpoint: endpointRaw,
        apiKey,
        batch,
      };
    }

    if (endpointExplicit === undefined || endpointExplicit.trim().length === 0) {
      console.warn('[ConfigManager] cloud.endpoint is missing, cloud upload disabled');
      return createDisabledCloudConfig({ endpoint: endpointRaw, apiKey });
    }

    if (!isValidCloudEndpoint(endpointExplicit)) {
      console.warn(
        `[ConfigManager] invalid cloud.endpoint="${endpointExplicit}", cloud upload disabled`,
      );
      return createDisabledCloudConfig({ endpoint: endpointExplicit, apiKey });
    }

    if (apiKey.length === 0) {
      console.warn('[CloudUpload] AGENTWATCH_API_KEY missing — cloud upload disabled');
      return createDisabledCloudConfig({ endpoint: endpointRaw, apiKey: '' });
    }

    return {
      enabled: true,
      endpoint: endpointExplicit,
      apiKey,
      batch,
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`[ConfigManager] failed to parse cloud config, upload disabled: ${detail}`);
    return createDisabledCloudConfig();
  }
}
