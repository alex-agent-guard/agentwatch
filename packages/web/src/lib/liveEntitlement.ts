import { normalizeActivationCode } from '@/lib/activationCode';
import { getAuthenticatedClient } from '@/lib/supabase';
import { isLiveGateEnabled } from '@/lib/liveGate';

export interface LiveEntitlementStatus {
  entitled: boolean;
  grantedAt?: string;
  source?: string;
  expiresAt?: string | null;
}

export type RedeemCodeResult =
  | { ok: true; alreadyEntitled?: boolean }
  | { ok: false; error: string };

const REDEEM_ERROR_ZH: Record<string, string> = {
  not_authenticated: '请先登录后再兑换',
  invalid_code_format: '激活码格式不正确（示例：AW-LIVE-A3F7-E2D1）',
  code_not_found: '激活码不存在，请检查是否输入完整',
  code_already_redeemed: '该激活码已被使用，一码仅可兑换一次',
  code_revoked: '该激活码已作废，请联系客服',
  code_expired: '该激活码已过期',
  account_already_has_live: '您的账户已开通 Live',
};

function mapRedeemError(message: string): string {
  for (const [key, zh] of Object.entries(REDEEM_ERROR_ZH)) {
    if (message.includes(key)) {
      return zh;
    }
  }
  return message || '兑换失败，请稍后重试';
}

/** Live 门禁关闭（Mock / VITE_LIVE_GATE=false）时视为已开通 */
export async function fetchLiveEntitlementStatus(): Promise<LiveEntitlementStatus> {
  if (!isLiveGateEnabled()) {
    return { entitled: true, source: 'gate_disabled' };
  }

  const client = getAuthenticatedClient();
  const { data: hasLive, error: rpcError } = await client.rpc('has_live_entitlement');

  if (rpcError) {
    return { entitled: false };
  }

  if (!hasLive) {
    return { entitled: false };
  }

  const { data: rows, error: selectError } = await client
    .from('live_entitlements')
    .select('granted_at, source, expires_at')
    .maybeSingle();

  if (selectError || !rows) {
    return { entitled: true };
  }

  return {
    entitled: true,
    grantedAt: rows.granted_at as string | undefined,
    source: rows.source as string | undefined,
    expiresAt: rows.expires_at as string | null | undefined,
  };
}

export async function redeemLiveActivationCode(rawCode: string): Promise<RedeemCodeResult> {
  if (!isLiveGateEnabled()) {
    return { ok: true };
  }

  const normalized = normalizeActivationCode(rawCode);
  if (!normalized) {
    return { ok: false, error: REDEEM_ERROR_ZH.invalid_code_format };
  }

  const client = getAuthenticatedClient();
  const { data, error } = await client.rpc('redeem_live_activation_code', {
    p_code: rawCode.trim(),
  });

  if (error) {
    return { ok: false, error: mapRedeemError(error.message) };
  }

  const payload = data as { ok?: boolean; already_entitled?: boolean } | null;
  if (payload?.already_entitled) {
    return { ok: true, alreadyEntitled: true };
  }

  return { ok: true };
}
