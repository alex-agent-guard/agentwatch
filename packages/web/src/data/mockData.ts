import type { AgentWatchEvent } from '@/types/events';

const now = Date.now();
const hour = 3600_000;

export const MOCK_EVENTS: AgentWatchEvent[] = [
  {
    install_id: 'demo-install',
    session_id: 'sess-001',
    agent_id: 'agent_demo',
    user_id: 'user_demo',
    event_id: 'evt-001',
    tool_name: 'filesystem.read',
    service_name: 'tools/call',
    timestamp_ms: now - hour * 2,
    duration_ms: 14,
    arg_count: 2,
    arg_key_hashes: ['a1b2c3d4', 'e5f6a7b8'],
    arg_value_types: ['string(12)', 'string(8)'],
    has_address: false,
    has_amount: false,
    l0_triggered_rules: [],
    l1_combined_score: 0.12,
    final_decision: 'ALLOW',
    chain_depth: 1,
    hmac: 'hmac-demo-001-abc123def456',
    risk_level: 'LOW',
  },
  {
    install_id: 'demo-install',
    session_id: 'sess-001',
    agent_id: 'agent_demo',
    user_id: 'user_demo',
    event_id: 'evt-002',
    tool_name: 'swap',
    service_name: 'tools/call',
    timestamp_ms: now - hour * 1.5,
    duration_ms: 42,
    arg_count: 3,
    arg_key_hashes: ['11aa22bb', '33cc44dd', '55ee66ff'],
    arg_value_types: ['string(42)', 'float', 'string(10)'],
    has_address: true,
    has_amount: true,
    amount_bucket: 'lt_10k',
    l0_triggered_rules: [{ ruleId: 'PROMPT_INJ_001', severity: 'HIGH' }],
    l1_combined_score: 0.78,
    final_decision: 'WARN',
    chain_depth: 2,
    previous_tool: 'filesystem.read',
    hmac: 'hmac-demo-002-fed789cba012',
    risk_level: 'MEDIUM',
  },
  {
    install_id: 'demo-install',
    session_id: 'sess-002',
    agent_id: 'agent_demo',
    user_id: 'user_demo',
    event_id: 'evt-003',
    tool_name: 'transfer',
    service_name: 'tools/call',
    timestamp_ms: now - hour,
    duration_ms: 88,
    arg_count: 4,
    arg_key_hashes: ['aa11bb22', 'cc33dd44'],
    arg_value_types: ['float', 'string(42)', 'int', 'bool'],
    has_address: true,
    has_amount: true,
    amount_bucket: 'gte_1m',
    l0_triggered_rules: [
      { ruleId: 'PARAM_TAMPER_001', severity: 'CRITICAL' },
      { ruleId: 'CHAIN_ABUSE_001', severity: 'HIGH' },
    ],
    l1_combined_score: 0.91,
    final_decision: 'BLOCK',
    chain_depth: 4,
    previous_tool: 'swap',
    hmac: 'hmac-demo-003-112233445566',
    risk_level: 'HIGH',
  },
  {
    install_id: 'demo-install',
    session_id: 'sess-002',
    agent_id: 'agent_demo',
    user_id: 'user_demo',
    event_id: 'evt-004',
    tool_name: 'query_balance',
    service_name: 'tools/call',
    timestamp_ms: now - hour * 0.5,
    duration_ms: 9,
    arg_count: 1,
    arg_key_hashes: ['ff00aa11'],
    arg_value_types: ['string(3)'],
    has_address: false,
    has_amount: false,
    l0_triggered_rules: [],
    l1_combined_score: 0.08,
    final_decision: 'ALLOW',
    chain_depth: 1,
    hmac: 'hmac-demo-004-778899aabbcc',
    risk_level: 'LOW',
  },
  {
    install_id: 'demo-install',
    session_id: 'sess-003',
    agent_id: 'agent_demo',
    user_id: 'user_demo',
    event_id: 'evt-005',
    tool_name: 'delegate_action',
    service_name: 'tools/call',
    timestamp_ms: now - hour * 0.25,
    duration_ms: 31,
    arg_count: 2,
    arg_key_hashes: ['deadbeef', 'cafebabe'],
    arg_value_types: ['string(16)', 'object'],
    has_address: false,
    has_amount: false,
    l0_triggered_rules: [{ ruleId: 'PERM_PROBE_001', severity: 'MEDIUM' }],
    l1_combined_score: 0.55,
    final_decision: 'WARN',
    chain_depth: 3,
    previous_tool: 'query_balance',
    hmac: 'hmac-demo-005-ddeeff001122',
    risk_level: 'MEDIUM',
  },
];

export const MOCK_STATS = {
  totalCalls: 2_400_000_000,
  caughtThreats: 14_200_000,
  uptime: 99.99,
};

export function getMockTrendData(): Array<{ time: string; score: number; blocks: number }> {
  return Array.from({ length: 12 }, (_, i) => ({
    time: `${String(i * 2).padStart(2, '0')}:00`,
    score: Math.round((0.15 + Math.sin(i / 2) * 0.12 + i * 0.02) * 100),
    blocks: Math.max(0, Math.round(Math.sin(i) * 3 + i * 0.5)),
  }));
}

export function getMockDistribution(): Array<{ name: string; value: number; color: string }> {
  const counts = { ALLOW: 0, WARN: 0, BLOCK: 0 };
  for (const e of MOCK_EVENTS) {
    counts[e.final_decision] += 1;
  }
  return [
    { name: 'ALLOW', value: counts.ALLOW + 42, color: '#00D4AA' },
    { name: 'WARN', value: counts.WARN + 8, color: '#F5A623' },
    { name: 'BLOCK', value: counts.BLOCK + 3, color: '#FF4D4F' },
  ];
}

export function getMockRadarData(): Array<{ subject: string; A: number; fullMark: number }> {
  return [
    { subject: 'Frequency', A: 72, fullMark: 100 },
    { subject: 'Amount', A: 45, fullMark: 100 },
    { subject: 'Chain', A: 58, fullMark: 100 },
    { subject: 'Rules', A: 81, fullMark: 100 },
    { subject: 'Markov', A: 63, fullMark: 100 },
    { subject: 'Latency', A: 90, fullMark: 100 },
  ];
}
