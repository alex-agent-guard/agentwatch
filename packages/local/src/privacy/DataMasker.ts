/**
 * AL-004 参数脱敏 — 4 级 MaskLevel + 敏感字段规则
 * 契约：task_router_logger_structure.md / agentwatch_v0_mvp_tasklist.md AL-004
 */
import { createHash } from 'node:crypto';

import { DEFAULT_LOG_MASK_CONFIG, DEFAULT_SENSITIVE_FIELDS, MARKOV_SCORE_KEYS } from '@packages/shared/constants';

import type { IConfigManager, LogMaskConfig, LoggingConfig } from '@packages/shared/types';
import type { MaskedParams as SharedMaskedParams } from '@packages/shared/types';
import type { RuleAction } from '@packages/shared/types';

/** 4 级脱敏策略 — 对齐架构文档 §7.3.1 */
export enum MaskLevel {
  FULL = 0,
  HASH = 1,
  TYPE = 2,
  DROP = 3,
}

interface MaskRule {
  paramPattern: string;
  level: MaskLevel;
}

/** 脱敏输出 — 扩展 shared MaskedParams，增加 originalKeys */
export interface MaskedParams extends SharedMaskedParams {
  originalKeys: string[];
}

export class DataMasker {
  private rules: MaskRule[] = [];
  private defaultLevel: MaskLevel = MaskLevel.HASH;
  private enabled = true;

  constructor(config?: {
    enabled?: boolean;
    rules?: Array<{ paramPattern: string; level: number }>;
    defaultLevel?: number;
    sensitiveFields?: string[];
  }) {
    if (config?.enabled !== undefined) {
      this.enabled = config.enabled;
    }
    if (config?.rules) {
      this.rules = config.rules.map((rule) => ({
        paramPattern: rule.paramPattern,
        level: rule.level as MaskLevel,
      }));
    }
    if (config?.sensitiveFields) {
      for (const field of config.sensitiveFields) {
        this.rules.push({
          paramPattern: this.escapeRegExp(field),
          level: MaskLevel.DROP,
        });
      }
    }
    if (config?.defaultLevel !== undefined) {
      this.defaultLevel = config.defaultLevel as MaskLevel;
    }
  }

  /** 从 LoggingConfig.mask 构造 — AsyncLogger 集成入口 */
  static fromLogMaskConfig(config: LogMaskConfig): DataMasker {
    const sensitiveFields = [
      ...new Set([...DEFAULT_SENSITIVE_FIELDS, ...config.sensitiveFields]),
    ];
    return new DataMasker({
      enabled: config.enabled,
      defaultLevel: config.level,
      sensitiveFields,
      rules: sensitiveFields.map((field) => ({
        paramPattern: field,
        level: MaskLevel.DROP,
      })),
    });
  }

  /**
   * 从全局 logging 配置构造 — bootstrap / AsyncLogger 启动入口
   * 配置缺失或解析失败时回退 DEFAULT_LOG_MASK_CONFIG，不抛出
   */
  static fromGlobalConfig(
    source?: Partial<LoggingConfig> | LogMaskConfig | null,
  ): DataMasker {
    try {
      return DataMasker.fromLogMaskConfig(DataMasker.resolveMaskConfig(source));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[DataMasker] failed to read mask config, using defaults: ${detail}`,
      );
      return DataMasker.fromLogMaskConfig(DataMasker.defaultMaskConfig());
    }
  }

  /** 从 ConfigManager 读取 logging.mask — 启动时全局配置驱动 */
  static fromConfigManager(
    configManager: Pick<IConfigManager, 'getLoggingConfig' | 'getProxyConfig'>,
  ): DataMasker {
    try {
      if (typeof configManager.getLoggingConfig === 'function') {
        return DataMasker.fromGlobalConfig(configManager.getLoggingConfig());
      }
      return DataMasker.fromGlobalConfig(configManager.getProxyConfig().agentWatch.logging);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[DataMasker] failed to read ConfigManager mask config, using defaults: ${detail}`,
      );
      return DataMasker.fromLogMaskConfig(DataMasker.defaultMaskConfig());
    }
  }

  /** 解析 mask 配置片段 — 支持 LoggingConfig 或裸 LogMaskConfig */
  static resolveMaskConfig(
    source?: Partial<LoggingConfig> | LogMaskConfig | null,
  ): LogMaskConfig {
    if (source === undefined || source === null) {
      return DataMasker.defaultMaskConfig();
    }

    if ('mask' in source) {
      const mask = source.mask;
      if (mask !== undefined) {
        return DataMasker.normalizeMaskConfig(mask);
      }
      return DataMasker.defaultMaskConfig();
    }

    if ('enabled' in source && 'level' in source && 'sensitiveFields' in source) {
      return DataMasker.normalizeMaskConfig(source as LogMaskConfig);
    }

    return DataMasker.defaultMaskConfig();
  }

  private static defaultMaskConfig(): LogMaskConfig {
    return {
      enabled: DEFAULT_LOG_MASK_CONFIG.enabled,
      level: DEFAULT_LOG_MASK_CONFIG.level,
      sensitiveFields: [...DEFAULT_LOG_MASK_CONFIG.sensitiveFields],
    };
  }

  private static normalizeMaskConfig(mask: Partial<LogMaskConfig>): LogMaskConfig {
    const defaults = DataMasker.defaultMaskConfig();
    const level = mask.level;
    const normalizedLevel =
      level === 0 || level === 1 || level === 2 || level === 3
        ? level
        : defaults.level;

    const sensitiveFields = Array.isArray(mask.sensitiveFields)
      ? mask.sensitiveFields.filter((field): field is string => typeof field === 'string')
      : defaults.sensitiveFields;

    return {
      enabled: typeof mask.enabled === 'boolean' ? mask.enabled : defaults.enabled,
      level: normalizedLevel,
      sensitiveFields:
        sensitiveFields.length > 0 ? sensitiveFields : defaults.sensitiveFields,
    };
  }

  /** 是否应对当前决策执行脱敏 — 保留 AsyncLogger 决策门控语义 */
  shouldMask(decision: RuleAction): boolean {
    if (!this.enabled) {
      return false;
    }
    if (decision === 'BLOCK' || decision === 'WARN' || decision === 'ESCALATE') {
      return true;
    }
    return this.defaultLevel >= MaskLevel.HASH;
  }

  /**
   * AsyncLogger 兼容入口 — 仅脱敏敏感字段，非敏感键原样保留
   */
  maskParams(
    params: Record<string, unknown>,
    decision: RuleAction,
    toolName = 'unknown',
  ): Record<string, unknown> | SharedMaskedParams {
    if (!this.shouldMask(decision)) {
      return params;
    }

    const maskedValues: Record<string, unknown> = {};
    const typeSignatures: Record<string, string> = {};
    const hashes: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (this.matchesSensitiveKey(key)) {
        this.applyMaskLevel(
          this.getMaskLevel(key),
          key,
          value,
          maskedValues,
          typeSignatures,
          hashes,
        );
        continue;
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        maskedValues[key] = this.maskNestedRecord(
          value as Record<string, unknown>,
          decision,
          toolName,
          typeSignatures,
          hashes,
          `${key}.`,
        );
        continue;
      }

      maskedValues[key] = value;
    }

    return { maskedValues, typeSignatures, hashes };
  }

  /** Markov 相关 L1 分数脱敏 — 保留原有 AsyncLogger 行为 */
  maskL1Scores(
    scores: Record<string, number>,
    decision: RuleAction,
  ): Record<string, number> {
    if (!this.shouldMask(decision)) {
      return scores;
    }

    const masked: Record<string, number> = {};
    for (const [key, value] of Object.entries(scores)) {
      if (MARKOV_SCORE_KEYS.some((entry) => key.includes(entry))) {
        masked[key] = this.roundMaskedNumber(value);
        continue;
      }
      masked[key] = value;
    }
    return masked;
  }

  /** 架构文档核心 mask() — 对全部参数字段按规则级别脱敏 */
  mask(toolName: string, params: Record<string, unknown>): MaskedParams {
    void toolName;
    const result: MaskedParams = {
      originalKeys: Object.keys(params),
      maskedValues: {},
      typeSignatures: {},
      hashes: {},
    };

    for (const [key, value] of Object.entries(params)) {
      const level = this.getMaskLevel(key);
      const typeSig = this.getTypeSignature(value);
      result.typeSignatures[key] = typeSig;
      this.applyMaskLevel(level, key, value, result.maskedValues, result.typeSignatures, result.hashes);
    }

    return result;
  }

  private maskNestedRecord(
    record: Record<string, unknown>,
    decision: RuleAction,
    toolName: string,
    typeSignatures: Record<string, string>,
    hashes: Record<string, string>,
    prefix: string,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const fullKey = `${prefix}${key}`;
      if (this.matchesSensitiveKey(key) || this.matchesSensitiveKey(fullKey)) {
        this.applyMaskLevel(
          this.getMaskLevel(fullKey),
          fullKey,
          value,
          output,
          typeSignatures,
          hashes,
          key,
        );
        continue;
      }
      output[key] = value;
    }
    void decision;
    void toolName;
    return output;
  }

  private applyMaskLevel(
    level: MaskLevel,
    key: string,
    value: unknown,
    maskedValues: Record<string, unknown>,
    typeSignatures: Record<string, string>,
    hashes: Record<string, string>,
    outputKey?: string,
  ): void {
    const targetKey = outputKey ?? key;
    typeSignatures[key] = this.getTypeSignature(value);

    switch (level) {
      case MaskLevel.FULL:
        maskedValues[targetKey] = value;
        break;
      case MaskLevel.HASH: {
        const hash = this.hashValue(value);
        hashes[key] = hash;
        maskedValues[targetKey] = `[HASH:${hash.slice(0, 8)}]`;
        break;
      }
      case MaskLevel.TYPE:
        maskedValues[targetKey] = `<${this.getTypeSignature(value)}>`;
        break;
      case MaskLevel.DROP:
        maskedValues[targetKey] = '[REDACTED]';
        break;
    }
  }

  private getMaskLevel(paramName: string): MaskLevel {
    for (const rule of this.rules) {
      if (new RegExp(rule.paramPattern, 'i').test(paramName)) {
        return rule.level;
      }
    }
    return this.defaultLevel;
  }

  private matchesSensitiveKey(key: string): boolean {
    return this.rules.some((rule) => new RegExp(rule.paramPattern, 'i').test(key));
  }

  private hashValue(value: unknown): string {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    return createHash('sha256').update(payload).digest('hex');
  }

  private getTypeSignature(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'number') {
      return value % 1 === 0 ? 'int' : 'float';
    }
    if (typeof value === 'string') {
      if (/^0x[a-fA-F0-9]{40}$/i.test(value)) {
        return 'address';
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return 'datetime';
      }
      return `string(${value.length})`;
    }
    if (typeof value === 'boolean') {
      return 'bool';
    }
    if (Array.isArray(value)) {
      return `array(${value.length})`;
    }
    if (typeof value === 'object') {
      return 'object';
    }
    return typeof value;
  }

  private roundMaskedNumber(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(value * 100) / 100;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
