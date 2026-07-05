export type FinalDecision = 'ALLOW' | 'WARN' | 'BLOCK';
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TriggeredRuleRow {
  ruleId: string;
  severity: string;
}

/** Aligns with Supabase events DDL */
export interface AgentWatchEvent {
  id?: string;
  install_id: string;
  session_id: string;
  agent_id: string;
  user_id: string;
  event_id: string;
  tool_name: string;
  service_name: string;
  timestamp_ms: number;
  duration_ms: number;
  arg_count: number;
  arg_key_hashes: string[];
  arg_value_types: string[];
  has_address: boolean;
  has_amount: boolean;
  amount_bucket?: string | null;
  l0_triggered_rules: TriggeredRuleRow[];
  l1_combined_score: number;
  final_decision: FinalDecision;
  chain_depth: number;
  previous_tool?: string | null;
  hmac: string;
  risk_level?: RiskLevel;
}

export function riskScoreDisplay(score: number | null | undefined): number {
  return Math.round((score ?? 0) * 100);
}

export function riskColor(score: number, decision: FinalDecision): string {
  if (decision === 'BLOCK') return '#FF4D4F';
  if (decision === 'WARN' || score >= 0.7) return '#F5A623';
  return '#00D4AA';
}

export function actionDisplay(row: Pick<AgentWatchEvent, 'tool_name'>): string {
  return row.tool_name;
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const INSTALL_ID_KEY = 'agentwatch_install_id';
export const ACTIVE_INSTALL_ID_KEY = 'agentwatch_active_install_id';

export function getStoredInstallId(): string {
  return localStorage.getItem(INSTALL_ID_KEY) ?? 'demo-install';
}

export function setStoredInstallId(id: string): void {
  localStorage.setItem(INSTALL_ID_KEY, id);
}

export function getActiveInstallId(): string {
  return (
    localStorage.getItem(ACTIVE_INSTALL_ID_KEY) ??
    localStorage.getItem(INSTALL_ID_KEY) ??
    'demo-install'
  );
}

export function setActiveInstallId(id: string): void {
  localStorage.setItem(ACTIVE_INSTALL_ID_KEY, id);
  localStorage.setItem(INSTALL_ID_KEY, id);
}
