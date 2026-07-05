import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://kbjcikgoawxhotwwqtin.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiamNpa2dvYXd4aG90d3dxdGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzU4NzcsImV4cCI6MjA5ODc1MTg3N30.msWhe0oqAf_lmQoHOE5BmrMTDNevRls0qjUA-vnqfYQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Mock 模式 — 未接 Auth / RLS 时可演示 UI */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 已登录用户的 Supabase 客户端（RLS 使用 auth.uid()） */
export function getAuthenticatedClient(): SupabaseClient {
  return supabase;
}
