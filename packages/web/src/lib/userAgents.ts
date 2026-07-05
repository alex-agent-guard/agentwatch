import { shouldUseDemoData } from '@/lib/session';
import { getAuthenticatedClient } from '@/lib/supabase';

export interface UserAgentRow {
  id: string;
  user_id: string;
  install_id: string;
  label: string;
  linked_at: string;
  updated_at: string;
}

const MOCK_AGENTS: UserAgentRow[] = [
  {
    id: 'mock-1',
    user_id: 'mock-user',
    install_id: 'demo-install',
    label: 'Demo Agent',
    linked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export async function listUserAgents(): Promise<{ data: UserAgentRow[]; error: string | null }> {
  if (shouldUseDemoData()) {
    return { data: MOCK_AGENTS, error: null };
  }

  const { data, error } = await getAuthenticatedClient()
    .from('user_agents')
    .select('id, user_id, install_id, label, linked_at, updated_at')
    .order('linked_at', { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []) as UserAgentRow[], error: null };
}

export async function bindInstallId(
  installId: string,
  label = 'My Agent',
): Promise<{ data: UserAgentRow | null; error: string | null }> {
  const trimmed = installId.trim();
  if (!trimmed) {
    return { data: null, error: 'install_id 不能为空' };
  }

  if (shouldUseDemoData()) {
    const row: UserAgentRow = {
      id: `mock-${String(Date.now())}`,
      user_id: 'mock-user',
      install_id: trimmed,
      label,
      linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    MOCK_AGENTS.unshift(row);
    return { data: row, error: null };
  }

  const { data, error } = await getAuthenticatedClient().rpc('bind_install_id', {
    p_install_id: trimmed,
    p_label: label,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as UserAgentRow, error: null };
}

export async function registerUploadSecret(
  installId: string,
  uploadSecret: string,
): Promise<{ ok: boolean; error: string | null; secretPrefix?: string }> {
  const trimmedId = installId.trim();
  const trimmedSecret = uploadSecret.trim();
  if (!trimmedId || !trimmedSecret) {
    return { ok: false, error: 'install_id 与 upload_secret 均不能为空' };
  }

  if (shouldUseDemoData()) {
    return { ok: true, error: null, secretPrefix: trimmedSecret.slice(0, 8) };
  }

  const { data, error } = await getAuthenticatedClient().rpc('register_upload_secret', {
    p_install_id: trimmedId,
    p_upload_secret: trimmedSecret,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as { secret_prefix?: string } | null;
  return {
    ok: true,
    error: null,
    secretPrefix: payload?.secret_prefix,
  };
}

export async function removeUserAgent(installId: string): Promise<{ error: string | null }> {
  if (shouldUseDemoData()) {
    const index = MOCK_AGENTS.findIndex((row) => row.install_id === installId);
    if (index >= 0) {
      MOCK_AGENTS.splice(index, 1);
    }
    return { error: null };
  }

  const { error } = await getAuthenticatedClient()
    .from('user_agents')
    .delete()
    .eq('install_id', installId);

  return { error: error?.message ?? null };
}
