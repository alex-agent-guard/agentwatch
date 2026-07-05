import type { FinalDecision } from '@/types/events';

export type RiskCopyLayer = 'L0' | 'Fusion' | 'L1';

export interface RiskCopyEntry {
  userTitleZh: string;
  layer: RiskCopyLayer;
  defaultAction: string;
  triggerPlainZh: string;
  riskPlainZh: string;
  userAction: string;
}

/** ruleId / combination id → 运营者可读说明（对齐 Kimi 手册 + builtin.ts） */
export const RULE_USER_COPY: Record<string, RiskCopyEntry> = {
  GOAL_HIJACK_001: {
    userTitleZh: '指令劫持',
    layer: 'L0',
    defaultAction: 'BLOCK',
    triggerPlainZh: '参数里出现覆盖先前指令的语句',
    riskPlainZh: '攻击者试图让 Agent 忽略原始任务，转而执行恶意指令。',
    userAction: '暂停 Agent，检查输入来源，移除恶意内容后重启。',
  },
  GOAL_HIJACK_002: {
    userTitleZh: '角色覆盖',
    layer: 'L0',
    defaultAction: 'BLOCK',
    triggerPlainZh: '参数含角色设定、系统冒充或可疑链上地址',
    riskPlainZh: '攻击者试图覆盖 Agent 角色或伪装地址引导转账。',
    userAction: '检查参数上下文，确认为正常业务后调整输入格式。',
  },
  PARAM_TAMPER_001: {
    userTitleZh: '大额转账',
    layer: 'L0',
    defaultAction: 'BLOCK',
    triggerPlainZh: 'transfer 工具且金额 ≥ 10 万',
    riskPlainZh: 'Agent 可能被诱导执行超阈值大额转账，上链后不可逆。',
    userAction: '人工复核金额与收款地址，必要时调整阈值或白名单。',
  },
  CHAIN_ABUSE_001: {
    userTitleZh: '工具链滥用',
    layer: 'L0',
    defaultAction: 'BLOCK',
    triggerPlainZh: '高危工具连续调用且链深度 ≥ 3',
    riskPlainZh: '多步工具链可能是在编排读密钥、外传、转账等组合攻击。',
    userAction: '逐步检查调用链，合法流程可加入可信链白名单。',
  },
  PERM_PROBE_001: {
    userTitleZh: '权限探测',
    layer: 'L0',
    defaultAction: 'WARN',
    triggerPlainZh: '连续 3 次及以上工具调用失败',
    riskPlainZh: '可能在系统性探测 Agent 权限边界，为后续攻击做准备。',
    userAction: '观察失败是否呈轮换规律，调试完成后重新评估。',
  },
  SUPPLY_CHAIN_001: {
    userTitleZh: '供应链风险',
    layer: 'L0',
    defaultAction: 'WARN',
    triggerPlainZh: '工具来源不在可信白名单',
    riskPlainZh: '未知来源工具可能含恶意逻辑或后门。',
    userAction: '仅允许经审计的工具来源，其余禁止调用。',
  },
  FREQ_001: {
    userTitleZh: '极端频率',
    layer: 'L0',
    defaultAction: 'BLOCK',
    triggerPlainZh: '1 分钟内工具调用 ≥ 100 次',
    riskPlainZh: '高频调用可能是自动化攻击或失控循环。',
    userAction: '暂停 Agent，确认批处理任务后申请频率豁免。',
  },
  PROMPT_INJ_001: {
    userTitleZh: '分隔符注入',
    layer: 'L0',
    defaultAction: 'WARN',
    triggerPlainZh: '参数含连续分隔符或 HTML/XML 闭合标签',
    riskPlainZh: '可能试图破坏 prompt 结构，夹带额外指令。',
    userAction: '检查分隔符前后是否有可疑指令，正常文档需人工确认。',
  },
  high_value_transfer: {
    userTitleZh: '高危转账组合',
    layer: 'Fusion',
    defaultAction: '提升得分',
    triggerPlainZh: '大额转账 + 工具链滥用同时出现',
    riskPlainZh: '大额资金请求叠加多步工具链，需双重复核。',
    userAction: '逐项核查链上每一步的业务合理性。',
  },
  coordinated_attack: {
    userTitleZh: '协同攻击组合',
    layer: 'Fusion',
    defaultAction: '提升得分',
    triggerPlainZh: '指令劫持 + 分隔符注入同时出现',
    riskPlainZh: '典型协同 prompt 攻击，试图完全控制 Agent。',
    userAction: '人工复核全部参数，暂不放行。',
  },
  rapid_probing: {
    userTitleZh: '快速试探组合',
    layer: 'Fusion',
    defaultAction: '提升得分',
    triggerPlainZh: '权限探测 + 极端频率同时出现',
    riskPlainZh: '疑似自动化渗透或攻击前侦察。',
    userAction: '审查调用来源与时间分布。',
  },
  l1_stat_anomaly: {
    userTitleZh: '行为异常',
    layer: 'L1',
    defaultAction: 'WARN/BLOCK',
    triggerPlainZh: '行为模式相对历史基线统计偏离',
    riskPlainZh: '未命中确定性规则，但调用频率、序列或错误率等维度异常。',
    userAction: '结合工具与时间线人工判断，观察基线是否需更新。',
  },
};

export function getRiskCopy(key: string): RiskCopyEntry | undefined {
  return RULE_USER_COPY[key];
}

export function getRiskTitle(key: string): string {
  return getRiskCopy(key)?.userTitleZh ?? key;
}

const COMBINATION_HINTS: Array<{ id: string; match: (ruleIds: Set<string>) => boolean }> = [
  {
    id: 'high_value_transfer',
    match: (ids) => ids.has('PARAM_TAMPER_001') && ids.has('CHAIN_ABUSE_001'),
  },
  {
    id: 'coordinated_attack',
    match: (ids) =>
      ids.has('PROMPT_INJ_001') &&
      (ids.has('GOAL_HIJACK_001') || ids.has('GOAL_HIJACK_002')),
  },
  {
    id: 'rapid_probing',
    match: (ids) => ids.has('PERM_PROBE_001') && ids.has('FREQ_001'),
  },
];

export function inferCombinationHints(ruleIds: string[]): RiskCopyEntry[] {
  const set = new Set(ruleIds);
  const out: RiskCopyEntry[] = [];

  for (const combo of COMBINATION_HINTS) {
    if (!combo.match(set)) continue;
    const copy = getRiskCopy(combo.id);
    if (copy) out.push(copy);
  }

  return out;
}

export function shouldShowL1Anomaly(
  ruleIds: string[],
  score: number,
  decision: FinalDecision,
): boolean {
  return ruleIds.length === 0 && score >= 0.7 && decision !== 'ALLOW';
}
