/**
 * L0 Rule Engine — 预编译多维索引 + 9 种 MatchType + 5 种 ConditionLogic
 * 契约：IRuleEngine (api.types.ts) + rule.types.ts / event.types.ts
 */
import { readFileSync } from 'node:fs';

import { parseRuleSetFileContent } from './rule-set-file-parser.js';

import {
  DEFAULT_MAX_MATCH_TIME_MS,
  EWMA_ALPHA,
  LATENCY_SAMPLE_MAX,
  REGEX_CACHE_MAX,
  RiskType,
} from '@packages/shared/constants';

import type {
  CompiledCondition,
  CompiledRule,
  ConditionLogic,
  DetectionEvent,
  FieldSource,
  IRuleEngine,
  MatcherFn,
  MatchType,
  Rule,
  RuleCondition,
  RuleEngineStats,
  RuleMatchResult,
  RuleSet,
} from '@packages/shared/types';

// ─── LRU Cache — task_l0_engine.md L0-IDX-04 正则编译缓存 ─────────────────────

class LRUCache<K, V> {
  private readonly cache = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, value);
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }
}

// ─── Trie Matcher — task_l0_engine.md L0-IDX-02 前缀索引 ────────────────────

class TrieNode {
  children = new Map<string, TrieNode>();
  rules: CompiledRule[] = [];
  isEndOfWord = false;
}

class TrieMatcher {
  private readonly root = new TrieNode();

  insert(pattern: string, rule: CompiledRule): void {
    let node = this.root;
    for (const char of pattern) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
    }
    node.isEndOfWord = true;
    node.rules.push(rule);
  }

  search(text: string): CompiledRule[] {
    const results: CompiledRule[] = [];
    let node = this.root;
    for (const char of text) {
      if (!node.children.has(char)) {
        break;
      }
      node = node.children.get(char)!;
      if (node.isEndOfWord) {
        results.push(...node.rules);
      }
    }
    return results;
  }

  reset(): void {
    this.root.children.clear();
    this.root.rules.length = 0;
    this.root.isEndOfWord = false;
  }
}

// ─── Aho-Corasick Matcher — task_l0_engine.md L0-IDX-03 多模式索引 ──────────

class ACNode {
  children = new Map<string, ACNode>();
  fail: ACNode | null = null;
  output: CompiledRule[] = [];
  depth = 0;
}

class AhoCorasickMatcher {
  private readonly root = new ACNode();
  private built = false;

  addPattern(pattern: string, rule: CompiledRule): void {
    this.built = false;
    let node = this.root;
    for (const char of pattern) {
      if (!node.children.has(char)) {
        node.children.set(char, new ACNode());
      }
      node = node.children.get(char)!;
      node.depth++;
    }
    node.output.push(rule);
  }

  build(): void {
    const queue: ACNode[] = [];
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [char, child] of current.children) {
        queue.push(child);
        let failNode: ACNode | null = current.fail;
        while (failNode !== null && !failNode.children.has(char)) {
          failNode = failNode.fail;
        }
        child.fail = failNode?.children.get(char) ?? this.root;
        child.output.push(...child.fail.output);
      }
    }

    this.built = true;
  }

  search(text: string): CompiledRule[] {
    if (!this.built) {
      this.build();
    }

    const results: CompiledRule[] = [];
    const seen = new Set<string>();
    let node: ACNode = this.root;

    for (const char of text) {
      while (node !== this.root && !node.children.has(char)) {
        node = node.fail ?? this.root;
      }
      node = node.children.get(char) ?? this.root;

      for (const rule of node.output) {
        if (!seen.has(rule.id)) {
          seen.add(rule.id);
          results.push(rule);
        }
      }
    }

    return results;
  }

  reset(): void {
    this.root.children.clear();
    this.root.output.length = 0;
    this.root.fail = null;
    this.root.depth = 0;
    this.built = false;
  }
}

// ─── Rule Engine ─────────────────────────────────────────────────────────────

/**
 * L0 规则引擎 — 预编译多维索引 + 9 种 MatchType + 5 种 ConditionLogic
 * 契约：task_l0_engine.md L0-ENG-01~04 / IRuleEngine (api.types.ts)
 */
export class RuleEngine implements IRuleEngine {
  private readonly exactIndex = new Map<string, CompiledRule[]>();
  private readonly trieIndex = new TrieMatcher();
  private readonly acIndex = new AhoCorasickMatcher();
  private readonly regexCache = new LRUCache<string, RegExp>(REGEX_CACHE_MAX);
  private readonly numericRules: CompiledRule[] = [];
  private readonly functionRules: CompiledRule[] = [];
  private readonly fallbackRules: CompiledRule[] = [];
  private readonly alwaysEvaluateRules: CompiledRule[] = [];
  private readonly compiledRules: CompiledRule[] = [];
  private readonly ruleMetadata = new Map<string, Rule>();

  private totalRules = 0;
  private enabledRules = 0;
  private totalMatches = 0;
  private avgLatencyMs = 0;
  private p99LatencyMs = 0;
  private readonly latencySamples: number[] = [];

  private readonly maxMatchTimeMs: number;
  private loadedRuleSet: RuleSet | null = null;

  // TODO(DR-V1): 动态热重载规则集 — reloadRuleSet() 无锁双缓冲切换，支持运行时增量更新
  // TODO(DR-V1): getFieldValue 多粒度缓存 — 按 event 指纹缓存 FieldSource→value 映射，减少重复路径解析
  // TODO(DR-V1): 全局 getFieldValue 路径解析优化 — 预编译 FieldSource→accessor 查找表替代 switch

  constructor(options?: { maxMatchTimeMs?: number }) {
    this.maxMatchTimeMs = options?.maxMatchTimeMs ?? DEFAULT_MAX_MATCH_TIME_MS;
  }

  /** L0 核心匹配入口 — 多维索引并行扫描，P99 < DEFAULT_MAX_MATCH_TIME_MS */
  match(event: DetectionEvent): RuleMatchResult[] {
    const perfStart = performance.now();
    const eventId = this.resolveEventId(event);

    try {
      this.assertMatchBudget(perfStart, eventId, 'match_start');

      const matchedRules = new Set<string>();
      const results: RuleMatchResult[] = [];

      this.matchExactIndex(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_exact_index');

      this.matchTrieIndex(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_trie_index');

      this.matchACIndex(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_ac_index');

      this.matchNumericRules(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_numeric_rules');

      this.matchFunctionRules(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_function_rules');

      this.matchFallbackRules(event, matchedRules, results, perfStart, eventId);
      this.assertMatchBudget(perfStart, eventId, 'match_fallback_rules');

      this.matchAlwaysEvaluateRules(
        event,
        matchedRules,
        results,
        perfStart,
        eventId,
      );
      this.assertMatchBudget(perfStart, eventId, 'match_always_evaluate_rules');

      const durationMs = performance.now() - perfStart;
      this.updateLatencyStats(durationMs);
      this.totalMatches += results.length;
      this.logPerformance('match', perfStart, this.maxMatchTimeMs);

      return results;
    } catch (cause) {
      if (cause instanceof Error && 'riskType' in cause) {
        throw cause;
      }
      throw this.createStructuredError(
        'Rule engine match failed',
        eventId,
        RiskType.RULE_ENGINE_MATCH_FAILED,
        cause,
      );
    }
  }

  /** 编译并索引 RuleSet — task_l0_engine.md L0-ENG-02 compileRuleSet */
  loadRuleSet(ruleSet: RuleSet): void {
    const perfStart = performance.now();
    this.loadedRuleSet = ruleSet;
    this.compileRuleSet(ruleSet);
    this.logPerformance('compileRuleSet', perfStart, 100);
  }

  /** 从外部 YAML/JSON 规则文件加载并编译规则集 */
  loadRuleSetFromFile(filePath: string): RuleSet {
    const perfStart = performance.now();
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw this.createStructuredError(
        `Failed to read rule file: ${filePath}`,
        null,
        RiskType.RULE_ENGINE_FILE_READ_ERROR,
        cause,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseRuleSetFileContent(raw, filePath);
    } catch (cause) {
      const riskType = filePath.toLowerCase().endsWith('.json')
        ? RiskType.RULE_ENGINE_JSON_PARSE_ERROR
        : RiskType.RULE_ENGINE_YAML_PARSE_ERROR;
      throw this.createStructuredError(
        `Failed to parse rule file: ${filePath}`,
        null,
        riskType,
        cause,
      );
    }

    if (!this.isRuleSet(parsed)) {
      throw this.createStructuredError(
        `Invalid RuleSet structure in file: ${filePath}`,
        null,
        RiskType.RULE_ENGINE_INVALID_RULESET,
        new Error('Parsed content does not conform to RuleSet'),
      );
    }

    this.loadedRuleSet = parsed;
    this.compileRuleSet(parsed);
    this.logPerformance('loadRuleSetFromFile', perfStart, 100);
    return parsed;
  }

  /** L0 引擎运行时指标 — task_l0_engine.md L0-ENG-20 */
  getStats(): RuleEngineStats {
    return {
      totalRules: this.totalRules,
      enabledRules: this.enabledRules,
      totalMatches: this.totalMatches,
      avgLatencyMs: this.avgLatencyMs,
      p99LatencyMs: this.p99LatencyMs,
    };
  }

  // ─── Compilation ───────────────────────────────────────────────────────────

  private compileRuleSet(ruleSet: RuleSet): void {
    this.resetIndexes();

    this.totalRules = ruleSet.rules.length;
    this.enabledRules = 0;

    for (const rule of ruleSet.rules) {
      if (!rule.enabled) {
        continue;
      }
      if (!this.isRuleEffective(rule)) {
        continue;
      }
      this.enabledRules++;

      const compiled = this.compileRule(rule);
      this.compiledRules.push(compiled);
      this.ruleMetadata.set(rule.id, rule);
      this.indexRule(compiled, rule);
      if (rule.conditionLogic === 'NOT') {
        this.alwaysEvaluateRules.push(compiled);
      }
    }

    this.acIndex.build();
  }

  private compileRule(rule: Rule): CompiledRule {
    const compiledConditions = rule.conditions.map((condition) =>
      this.compileCondition(condition),
    );

    return {
      id: rule.id,
      severity: rule.severity,
      action: rule.action,
      compiledConditions,
      conditionLogic: rule.conditionLogic,
      ...(rule.minWeight !== undefined ? { minWeight: rule.minWeight } : {}),
      priority: ruleSetPriorityFallback(rule),
    };
  }

  private compileCondition(condition: RuleCondition): CompiledCondition {
    const matcher = this.buildMatcher(condition.matchType, condition.pattern);
    return {
      id: condition.id,
      field: condition.field,
      matcher,
      weight: condition.weight ?? 1,
      negate: condition.negate ?? false,
    };
  }

  private buildMatcher(
    matchType: MatchType,
    pattern: RuleCondition['pattern'],
  ): MatcherFn {
    switch (matchType) {
      case 'EXACT':
        return (value: unknown) => String(value) === String(pattern);

      case 'PREFIX':
        return (value: unknown) =>
          typeof value === 'string' && value.startsWith(String(pattern));

      case 'CONTAINS':
        return (value: unknown) =>
          typeof value === 'string' && value.includes(String(pattern));

      case 'REGEX': {
        const regex = this.getOrCompileRegex(String(pattern));
        return (value: unknown) =>
          typeof value === 'string' && regex.test(value);
      }

      case 'SET': {
        const setValues = Array.isArray(pattern)
          ? pattern.map((item) => String(item))
          : [];
        return (value: unknown) => setValues.includes(String(value));
      }

      case 'NUMERIC_RANGE': {
        const range = this.parseNumericRange(String(pattern));
        return (value: unknown) => {
          const num = this.toNumber(value);
          if (num === null) {
            return false;
          }
          const aboveMin = range.minInclusive ? num >= range.min : num > range.min;
          const belowMax = range.maxInclusive ? num <= range.max : num < range.max;
          return aboveMin && belowMax;
        };
      }

      case 'SEMVER_RANGE': {
        const semverRange = this.parseSemverRange(String(pattern));
        return (value: unknown) => {
          if (typeof value !== 'string') {
            return false;
          }
          return this.checkSemverInRange(value, semverRange);
        };
      }

      case 'GLOB': {
        const regexPattern = this.globToRegex(String(pattern));
        const regex = this.getOrCompileRegex(regexPattern);
        return (value: unknown) =>
          typeof value === 'string' && regex.test(value);
      }

      case 'FUNCTION':
        // 运行时由 matchFunctionRules() + 外部函数注册表处理
        return () => false;

      default:
        return () => false;
    }
  }

  private getOrCompileRegex(pattern: string): RegExp {
    const cached = this.regexCache.get(pattern);
    if (cached !== undefined) {
      return cached;
    }
    let compiled: RegExp;
    try {
      compiled = new RegExp(pattern);
    } catch (cause) {
      throw this.createStructuredError(
        `Invalid regex pattern: ${pattern}`,
        null,
        RiskType.RULE_ENGINE_REGEX_COMPILE_ERROR,
        cause,
      );
    }
    this.regexCache.set(pattern, compiled);
    return compiled;
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  private indexRule(compiled: CompiledRule, rule: Rule): void {
    let needsFallback = false;
    let needsFunction = false;
    let needsNumeric = false;

    for (const condition of rule.conditions) {
      switch (condition.matchType) {
        case 'EXACT': {
          const key = `${condition.field}:${String(condition.pattern)}`;
          this.pushExactIndex(key, compiled);
          break;
        }
        case 'PREFIX':
          this.trieIndex.insert(String(condition.pattern), compiled);
          break;
        case 'CONTAINS':
          this.acIndex.addPattern(String(condition.pattern), compiled);
          break;
        case 'SET': {
          if (Array.isArray(condition.pattern)) {
            for (const item of condition.pattern) {
              const key = `${condition.field}:${String(item)}`;
              this.pushExactIndex(key, compiled);
            }
          }
          break;
        }
        case 'NUMERIC_RANGE':
        case 'SEMVER_RANGE':
          needsNumeric = true;
          break;
        case 'FUNCTION':
          needsFunction = true;
          break;
        case 'REGEX':
        case 'GLOB':
          needsFallback = true;
          break;
        default:
          needsFallback = true;
          break;
      }
    }

    if (needsNumeric && !this.numericRules.some((r) => r.id === compiled.id)) {
      this.numericRules.push(compiled);
    }
    if (needsFunction && !this.functionRules.some((r) => r.id === compiled.id)) {
      this.functionRules.push(compiled);
    }
    if (needsFallback && !this.fallbackRules.some((r) => r.id === compiled.id)) {
      this.fallbackRules.push(compiled);
    }
  }

  private pushExactIndex(key: string, rule: CompiledRule): void {
    const existing = this.exactIndex.get(key);
    if (existing !== undefined) {
      existing.push(rule);
      return;
    }
    this.exactIndex.set(key, [rule]);
  }

  // ─── Match Phases ──────────────────────────────────────────────────────────

  private matchExactIndex(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    for (const [fieldPath, value] of this.extractFields(event)) {
      const key = `${fieldPath}:${String(value)}`;
      const candidates = this.exactIndex.get(key);
      if (candidates === undefined) {
        continue;
      }

      for (const compiled of candidates) {
        if (matchedRules.has(compiled.id)) {
          continue;
        }
        const result = this.evaluateRule(compiled, event);
        if (result !== null) {
          matchedRules.add(compiled.id);
          results.push(result);
          if (compiled.severity === 'CRITICAL') {
            return;
          }
        }
        this.assertMatchBudget(perfStart, eventId, `evaluate_rule:${compiled.id}`);
      }
    }
  }

  private matchTrieIndex(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    for (const [, text] of this.extractStringFields(event)) {
      const candidates = this.trieIndex.search(text);
      for (const compiled of candidates) {
        if (matchedRules.has(compiled.id)) {
          continue;
        }
        const result = this.evaluateRule(compiled, event);
        if (result !== null) {
          matchedRules.add(compiled.id);
          results.push(result);
          if (compiled.severity === 'CRITICAL') {
            return;
          }
        }
        this.assertMatchBudget(perfStart, eventId, `trie_rule:${compiled.id}`);
      }
    }
  }

  private matchACIndex(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    const textFields = this.extractTextFields(event);
    if (textFields.length === 0) {
      return;
    }

    const combinedText = textFields.map(([, value]) => value).join('\x00');
    const candidates = this.acIndex.search(combinedText);

    for (const compiled of candidates) {
      if (matchedRules.has(compiled.id)) {
        continue;
      }
      const result = this.evaluateRule(compiled, event);
      if (result !== null) {
        matchedRules.add(compiled.id);
        results.push(result);
        if (compiled.severity === 'CRITICAL') {
          return;
        }
      }
      this.assertMatchBudget(perfStart, eventId, `ac_rule:${compiled.id}`);
    }
  }

  private matchNumericRules(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    for (const compiled of this.numericRules) {
      if (matchedRules.has(compiled.id)) {
        continue;
      }
      const result = this.evaluateRule(compiled, event);
      if (result !== null) {
        matchedRules.add(compiled.id);
        results.push(result);
        if (compiled.severity === 'CRITICAL') {
          return;
        }
      }
      this.assertMatchBudget(perfStart, eventId, `numeric_rule:${compiled.id}`);
    }
  }

  private matchFunctionRules(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    // TODO(DR-V1): FUNCTION 类型 — 接入外部函数注册表，运行时执行自定义 matcher
    for (const compiled of this.functionRules) {
      if (matchedRules.has(compiled.id)) {
        continue;
      }
      const result = this.evaluateRule(compiled, event);
      if (result !== null) {
        matchedRules.add(compiled.id);
        results.push(result);
        if (compiled.severity === 'CRITICAL') {
          return;
        }
      }
      this.assertMatchBudget(perfStart, eventId, `function_rule:${compiled.id}`);
    }
  }

  private matchFallbackRules(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    for (const compiled of this.fallbackRules) {
      if (matchedRules.has(compiled.id)) {
        continue;
      }
      const result = this.evaluateRule(compiled, event);
      if (result !== null) {
        matchedRules.add(compiled.id);
        results.push(result);
        if (compiled.severity === 'CRITICAL') {
          return;
        }
      }
      this.assertMatchBudget(perfStart, eventId, `fallback_rule:${compiled.id}`);
    }
  }

  private matchAlwaysEvaluateRules(
    event: DetectionEvent,
    matchedRules: Set<string>,
    results: RuleMatchResult[],
    perfStart: number,
    eventId: string,
  ): void {
    for (const compiled of this.alwaysEvaluateRules) {
      if (matchedRules.has(compiled.id)) {
        continue;
      }
      const result = this.evaluateRule(compiled, event);
      if (result !== null) {
        matchedRules.add(compiled.id);
        results.push(result);
        if (compiled.severity === 'CRITICAL') {
          return;
        }
      }
      this.assertMatchBudget(perfStart, eventId, `not_rule:${compiled.id}`);
    }
  }

  // ─── Rule Evaluation ─────────────────────────────────────────────────────────

  private evaluateRule(
    compiled: CompiledRule,
    event: DetectionEvent,
  ): RuleMatchResult | null {
    const meta = this.ruleMetadata.get(compiled.id);
    if (meta !== undefined && !this.isRuleEffective(meta, event.request.timestamp)) {
      return null;
    }

    const matchedConditions: string[] = [];
    const matchedFields: Record<string, unknown> = {};

    for (const condition of compiled.compiledConditions) {
      let fieldValue: unknown;
      try {
        fieldValue = this.getFieldValue(event, condition.field);
      } catch (cause) {
        throw this.createStructuredError(
          `Failed to extract field: ${condition.field}`,
          this.resolveEventId(event),
          RiskType.RULE_ENGINE_FIELD_VALUE_ERROR,
          cause,
        );
      }

      let matched = condition.matcher(fieldValue);
      if (condition.negate) {
        matched = !matched;
      }

      if (matched) {
        matchedConditions.push(condition.id);
        matchedFields[condition.field] = fieldValue;
      }
    }

    const ruleMatched = this.applyConditionLogic(
      compiled.conditionLogic,
      compiled.compiledConditions.length,
      matchedConditions,
      compiled.compiledConditions,
      compiled.minWeight,
    );

    if (!ruleMatched) {
      return null;
    }

    const confidence = this.calculateConfidence(
      compiled.conditionLogic,
      compiled.compiledConditions.length,
      matchedConditions,
      compiled.compiledConditions,
      compiled.minWeight,
    );

    return {
      ruleId: compiled.id,
      ruleName: meta?.name ?? compiled.id,
      severity: compiled.severity,
      action: compiled.action,
      matchedConditions,
      confidence,
      matchedFields,
      timestamp: Date.now(),
    };
  }

  private isRuleEffective(rule: Rule, timestamp: number = Date.now()): boolean {
    if (rule.effectiveFrom !== undefined && timestamp < rule.effectiveFrom) {
      return false;
    }
    if (rule.effectiveTo !== undefined && timestamp > rule.effectiveTo) {
      return false;
    }
    return true;
  }

  private applyConditionLogic(
    logic: ConditionLogic,
    totalConditions: number,
    matchedConditions: string[],
    compiledConditions: CompiledCondition[],
    minWeight?: number,
  ): boolean {
    switch (logic) {
      case 'AND':
        return matchedConditions.length === totalConditions;
      case 'OR':
        return matchedConditions.length > 0;
      case 'NOT':
        return matchedConditions.length === 0;
      case 'MAJORITY':
        return matchedConditions.length > totalConditions / 2;
      case 'WEIGHTED_SUM': {
        let sum = 0;
        for (const condition of compiledConditions) {
          if (matchedConditions.includes(condition.id)) {
            sum += condition.weight;
          }
        }
        return sum >= (minWeight ?? 1);
      }
      default:
        return false;
    }
  }

  private calculateConfidence(
    logic: ConditionLogic,
    totalConditions: number,
    matchedConditions: string[],
    compiledConditions: CompiledCondition[],
    minWeight?: number,
  ): number {
    if (totalConditions === 0) {
      return 0;
    }

    switch (logic) {
      case 'AND':
        return matchedConditions.length / totalConditions;
      case 'OR':
        return matchedConditions.length > 0 ? 1 : 0;
      case 'NOT':
        return matchedConditions.length === 0 ? 1 : 0;
      case 'MAJORITY': {
        const ratio = matchedConditions.length / totalConditions;
        return ratio > 0.5 ? ratio : 0;
      }
      case 'WEIGHTED_SUM': {
        const totalWeight = compiledConditions.reduce(
          (acc, condition) => acc + condition.weight,
          0,
        );
        if (totalWeight === 0) {
          return 0;
        }
        let sum = 0;
        for (const condition of compiledConditions) {
          if (matchedConditions.includes(condition.id)) {
            sum += condition.weight;
          }
        }
        const threshold = minWeight ?? 1;
        return Math.min(1, sum / Math.max(threshold, totalWeight));
      }
      default:
        return 0;
    }
  }

  // ─── Field Extraction ────────────────────────────────────────────────────────

  getFieldValue(event: DetectionEvent, field: FieldSource): unknown {
    switch (field) {
      case 'tool.name':
        return event.tool.name;
      case 'tool.version':
        return event.tool.version;
      case 'tool.source':
        return event.tool.source;
      case 'argument.name':
        return event.argument.name;
      case 'argument.value':
        return event.argument.value;
      case 'argument.type':
        return event.argument.type;
      case 'request.origin':
        return event.request.origin;
      case 'request.user_id':
        return event.request.user_id;
      case 'request.session_id':
        return event.request.session_id;
      case 'request.timestamp':
        return event.request.timestamp;
      case 'context.agent_id':
        return event.context?.agent_id;
      case 'context.skill_id':
        return event.context?.skill_id;
      case 'context.chain_depth':
        return event.context?.chain_depth;
      case 'metadata.frequency_1m':
        return event.metadata?.frequency_1m;
      case 'metadata.frequency_5m':
        return event.metadata?.frequency_5m;
      case 'metadata.consecutive_failures':
        return event.metadata?.consecutive_failures;
      default:
        return undefined;
    }
  }

  private extractFields(event: DetectionEvent): [string, unknown][] {
    const pairs: [string, unknown][] = [
      ['tool.name', event.tool.name],
    ];

    if (event.tool.version !== undefined) {
      pairs.push(['tool.version', event.tool.version]);
    }
    if (event.tool.source !== undefined) {
      pairs.push(['tool.source', event.tool.source]);
    }

    pairs.push(['argument.name', event.argument.name]);
    pairs.push(['argument.value', event.argument.value]);
    if (event.argument.type !== undefined) {
      pairs.push(['argument.type', event.argument.type]);
    }

    pairs.push(['request.timestamp', event.request.timestamp]);
    if (event.request.origin !== undefined) {
      pairs.push(['request.origin', event.request.origin]);
    }
    if (event.request.user_id !== undefined) {
      pairs.push(['request.user_id', event.request.user_id]);
    }
    if (event.request.session_id !== undefined) {
      pairs.push(['request.session_id', event.request.session_id]);
    }

    if (event.context?.agent_id !== undefined) {
      pairs.push(['context.agent_id', event.context.agent_id]);
    }
    if (event.context?.skill_id !== undefined) {
      pairs.push(['context.skill_id', event.context.skill_id]);
    }
    if (event.context?.chain_depth !== undefined) {
      pairs.push(['context.chain_depth', event.context.chain_depth]);
    }

    if (event.metadata?.frequency_1m !== undefined) {
      pairs.push(['metadata.frequency_1m', event.metadata.frequency_1m]);
    }
    if (event.metadata?.frequency_5m !== undefined) {
      pairs.push(['metadata.frequency_5m', event.metadata.frequency_5m]);
    }
    if (event.metadata?.consecutive_failures !== undefined) {
      pairs.push([
        'metadata.consecutive_failures',
        event.metadata.consecutive_failures,
      ]);
    }

    return pairs;
  }

  private extractStringFields(event: DetectionEvent): [string, string][] {
    return this.extractFields(event).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
  }

  private extractTextFields(event: DetectionEvent): [string, string][] {
    return this.extractStringFields(event).filter(
      ([fieldPath]) =>
        fieldPath === 'argument.value' ||
        fieldPath.endsWith('.value') ||
        fieldPath.endsWith('.name'),
    );
  }

  // ─── Parsers ─────────────────────────────────────────────────────────────────

  private parseNumericRange(pattern: string): {
    min: number;
    max: number;
    minInclusive: boolean;
    maxInclusive: boolean;
  } {
    const trimmed = pattern.trim();
    if (trimmed.length < 5) {
      return {
        min: 0,
        max: Infinity,
        minInclusive: true,
        maxInclusive: false,
      };
    }

    const minInclusive = trimmed.startsWith('[');
    const maxInclusive = trimmed.endsWith(']');
    const inner = trimmed.slice(1, -1);
    const commaIndex = inner.indexOf(',');
    if (commaIndex === -1) {
      return {
        min: 0,
        max: Infinity,
        minInclusive: true,
        maxInclusive: false,
      };
    }

    const minRaw = inner.slice(0, commaIndex).trim();
    const maxRaw = inner.slice(commaIndex + 1).trim();

    return {
      min: this.parseBound(minRaw, Number.NEGATIVE_INFINITY),
      max: this.parseBound(maxRaw, Infinity),
      minInclusive,
      maxInclusive,
    };
  }

  private parseBound(raw: string, fallback: number): number {
    if (raw === '-Infinity') {
      return Number.NEGATIVE_INFINITY;
    }
    if (raw === 'Infinity') {
      return Infinity;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseSemverRange(pattern: string): {
    kind: 'caret' | 'tilde' | 'gte' | 'exact' | 'range' | 'any';
    value: string;
    upper?: string;
  } {
    const trimmed = pattern.trim();
    if (trimmed === '*' || trimmed === '') {
      return { kind: 'any', value: trimmed };
    }
    if (trimmed.startsWith('^')) {
      return { kind: 'caret', value: trimmed.slice(1) };
    }
    if (trimmed.startsWith('~')) {
      return { kind: 'tilde', value: trimmed.slice(1) };
    }
    if (trimmed.startsWith('>=')) {
      return { kind: 'gte', value: trimmed.slice(2).trim() };
    }
    if (trimmed.includes(' - ')) {
      const [lower, upper] = trimmed.split(' - ').map((part) => part.trim());
      if (upper !== undefined && upper.length > 0) {
        return { kind: 'range', value: lower ?? '', upper };
      }
      return { kind: 'range', value: lower ?? '' };
    }
    return { kind: 'exact', value: trimmed };
  }

  private checkSemverInRange(
    version: string,
    range: ReturnType<RuleEngine['parseSemverRange']>,
  ): boolean {
    const parsed = this.parseSemver(version);
    if (parsed === null) {
      return false;
    }

    switch (range.kind) {
      case 'any':
        return true;
      case 'exact': {
        const target = this.parseSemver(range.value);
        return target !== null && this.compareSemver(parsed, target) === 0;
      }
      case 'gte': {
        const target = this.parseSemver(range.value);
        return target !== null && this.compareSemver(parsed, target) >= 0;
      }
      case 'caret': {
        const target = this.parseSemver(range.value);
        if (target === null) {
          return false;
        }
        const upper = {
          major: target.major + 1,
          minor: 0,
          patch: 0,
        };
        return (
          this.compareSemver(parsed, target) >= 0 &&
          this.compareSemver(parsed, upper) < 0
        );
      }
      case 'tilde': {
        const target = this.parseSemver(range.value);
        if (target === null) {
          return false;
        }
        const upper = {
          major: target.major,
          minor: target.minor + 1,
          patch: 0,
        };
        return (
          this.compareSemver(parsed, target) >= 0 &&
          this.compareSemver(parsed, upper) < 0
        );
      }
      case 'range': {
        const lower = this.parseSemver(range.value);
        const upper = range.upper ? this.parseSemver(range.upper) : null;
        if (lower === null) {
          return false;
        }
        const aboveLower = this.compareSemver(parsed, lower) >= 0;
        const belowUpper =
          upper === null ? true : this.compareSemver(parsed, upper) <= 0;
        return aboveLower && belowUpper;
      }
      default:
        return false;
    }
  }

  private parseSemver(
    version: string,
  ): { major: number; minor: number; patch: number } | null {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
    if (match === null) {
      return null;
    }
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    };
  }

  private compareSemver(
    left: { major: number; minor: number; patch: number },
    right: { major: number; minor: number; patch: number },
  ): number {
    if (left.major !== right.major) {
      return left.major - right.major;
    }
    if (left.minor !== right.minor) {
      return left.minor - right.minor;
    }
    return left.patch - right.patch;
  }

  private globToRegex(pattern: string): string {
    let regex = '^';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '*') {
        if (pattern[i + 1] === '*') {
          regex += '.*';
          i++;
        } else {
          regex += '[^/]*';
        }
        continue;
      }
      if (char === '?') {
        regex += '.';
        continue;
      }
      if ('\\.[]{}()+^$|'.includes(char ?? '')) {
        regex += `\\${char}`;
        continue;
      }
      regex += char;
    }
    regex += '$';
    return regex;
  }

  // ─── Stats & Performance ─────────────────────────────────────────────────────

  private updateLatencyStats(latencyMs: number): void {
    this.avgLatencyMs =
      this.avgLatencyMs === 0
        ? latencyMs
        : EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * this.avgLatencyMs;

    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > LATENCY_SAMPLE_MAX) {
      this.latencySamples.shift();
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const p99Index = Math.ceil(sorted.length * 0.99) - 1;
    this.p99LatencyMs = sorted[Math.max(0, p99Index)] ?? latencyMs;
  }

  private assertMatchBudget(
    perfStart: number,
    eventId: string,
    phase: string,
  ): void {
    const elapsed = performance.now() - perfStart;
    if (elapsed > this.maxMatchTimeMs) {
      throw this.createStructuredError(
        `Rule engine match timeout at phase=${phase} elapsedMs=${elapsed.toFixed(3)}`,
        eventId,
        RiskType.RULE_ENGINE_MATCH_TIMEOUT,
        new Error(`Exceeded maxMatchTimeMs=${String(this.maxMatchTimeMs)}`),
      );
    }
  }

  private logPerformance(
    operation: string,
    startMs: number,
    budgetMs: number,
  ): void {
    const durationMs = performance.now() - startMs;
    const withinBudget = durationMs <= budgetMs;
    console.info(
      `[RuleEngine][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private resetIndexes(): void {
    this.exactIndex.clear();
    this.trieIndex.reset();
    this.acIndex.reset();
    this.numericRules.length = 0;
    this.functionRules.length = 0;
    this.fallbackRules.length = 0;
    this.alwaysEvaluateRules.length = 0;
    this.compiledRules.length = 0;
    this.ruleMetadata.clear();
  }

  private resolveEventId(event: DetectionEvent): string {
    return event.request.session_id ?? String(event.request.timestamp);
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private isRuleSet(value: unknown): value is RuleSet {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as RuleSet;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      Array.isArray(candidate.rules)
    );
  }

  private createStructuredError(
    message: string,
    eventId: string | null,
    riskType: string,
    cause: unknown,
  ): Error {
    const base =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === 'string' ? cause : JSON.stringify(cause));

    const err = new Error(message, { cause: base });
    Object.assign(err, {
      eventId,
      riskType,
      originalStack: base.stack ?? String(cause),
    });
    return err;
  }
}

function ruleSetPriorityFallback(rule: Rule): number {
  const severityRank: Record<Rule['severity'], number> = {
    CRITICAL: 100,
    HIGH: 80,
    MEDIUM: 60,
    LOW: 40,
    INFO: 20,
  };
  return severityRank[rule.severity];
}
