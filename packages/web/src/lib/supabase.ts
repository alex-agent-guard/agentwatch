import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://kbjcikgoawxhotwwqtin.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiamNpa2dvYXd4aG90d3dxdGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzU4NzcsImV4cCI6MjA5ODc1MTg3N30.msWhe0oqAf_lmQoHOE5BmrMTDNevRls0qjUA-vnqfYQ';

const JWT_PATTERN = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/;

/** 去掉 Vercel 误粘贴的重复 key / 换行，避免 XHR setRequestHeader 报错 */
function resolveSupabaseJwt(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return fallback;
  }
  const match = trimmed.match(JWT_PATTERN);
  return match?.[0] ?? fallback;
}

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/$/, '');
export const SUPABASE_ANON_KEY = resolveSupabaseJwt(import.meta.env.VITE_SUPABASE_ANON_KEY, DEFAULT_ANON_KEY);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Dev Mock — true 时跳过登录、使用 mockData；Live 部署必须 false */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 已登录用户的 Supabase 客户端（RLS 使用 auth.uid()） */
export function getAuthenticatedClient(): SupabaseClient {
  return supabase;
}
