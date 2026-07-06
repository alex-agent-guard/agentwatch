import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('请在 packages/code-admin/.env.local 配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
  }
  return createClient(url, anonKey);
}

export type LiveCodeStats = {
  total: number;
  active: number;
  redeemed: number;
  revoked: number;
  by_batch: Array<{
    batch_id: string | null;
    total: number;
    active: number;
    redeemed: number;
  }>;
};

export type LiveCodeRow = {
  id: string;
  code_display: string | null;
  code_prefix: string;
  batch_id: string | null;
  sku: string;
  status: 'active' | 'redeemed' | 'revoked';
  redeemed_at: string | null;
  redeemed_email: string | null;
  redeemed_display_name: string | null;
  created_at: string;
  note: string | null;
};

export async function fetchStats(client: SupabaseClient): Promise<LiveCodeStats> {
  const { data, error } = await client.rpc('admin_live_code_stats');
  if (error) throw error;
  return data as LiveCodeStats;
}

export async function fetchCodes(
  client: SupabaseClient,
  opts: { batchId?: string; status?: string; limit?: number },
): Promise<LiveCodeRow[]> {
  const { data, error } = await client.rpc('admin_list_live_activation_codes', {
    p_batch_id: opts.batchId ?? null,
    p_status: opts.status ?? null,
    p_limit: opts.limit ?? 1000,
    p_offset: 0,
  });
  if (error) throw error;
  return (data ?? []) as LiveCodeRow[];
}

export async function checkIsAdmin(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('is_live_code_admin');
  if (error) return false;
  return Boolean(data);
}
