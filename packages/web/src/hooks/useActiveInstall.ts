import { useCallback, useEffect, useState } from 'react';

import { listUserAgents, type UserAgentRow } from '@/lib/userAgents';
import {
  getActiveInstallId,
  getStoredInstallId,
  setActiveInstallId,
  setStoredInstallId,
} from '@/types/events';

const AGENT_LIST_RETRIES = 3;
const AGENT_LIST_RETRY_MS = 450;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasBoundInstallHint(): boolean {
  const id = getActiveInstallId();
  return id.startsWith('agent_') && id !== 'demo-install';
}

export function useActiveInstall() {
  const [agents, setAgents] = useState<UserAgentRow[]>([]);
  const [activeInstallId, setActiveInstallIdState] = useState(getActiveInstallId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let lastError: string | null = null;
      let rows: UserAgentRow[] = [];

      for (let attempt = 0; attempt < AGENT_LIST_RETRIES; attempt += 1) {
        const res = await listUserAgents();
        rows = res.data;
        lastError = res.error;

        if (rows.length > 0 || !hasBoundInstallHint() || attempt === AGENT_LIST_RETRIES - 1) {
          break;
        }

        await delay(AGENT_LIST_RETRY_MS);
      }

      setAgents(rows);
      setError(lastError);

      if (rows.length > 0) {
        const current = getActiveInstallId();
        const exists = rows.some((row) => row.install_id === current);
        const agentLike = rows.filter((row) => row.install_id.startsWith('agent_'));
        const next = exists
          ? current
          : (agentLike[0]?.install_id ?? rows[0]!.install_id);
        setActiveInstallId(next);
        setStoredInstallId(next);
        setActiveInstallIdState(next);
      }
    } catch (err) {
      setAgents([]);
      setError(err instanceof Error ? err.message : '加载 Agent 列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  const selectInstallId = useCallback((installId: string) => {
    setActiveInstallId(installId);
    setStoredInstallId(installId);
    setActiveInstallIdState(installId);
  }, []);

  return {
    agents,
    activeInstallId: activeInstallId || getStoredInstallId(),
    loading,
    error,
    refreshAgents,
    selectInstallId,
  };
}
