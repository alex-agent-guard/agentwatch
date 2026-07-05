import { useCallback, useEffect, useState } from 'react';

import { listUserAgents, type UserAgentRow } from '@/lib/userAgents';
import {
  getActiveInstallId,
  getStoredInstallId,
  setActiveInstallId,
  setStoredInstallId,
} from '@/types/events';

export function useActiveInstall() {
  const [agents, setAgents] = useState<UserAgentRow[]>([]);
  const [activeInstallId, setActiveInstallIdState] = useState(getActiveInstallId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    setLoading(true);
    const res = await listUserAgents();
    setAgents(res.data);
    setError(res.error);

    if (res.data.length > 0) {
      const current = getActiveInstallId();
      const exists = res.data.some((row) => row.install_id === current);
      const agentLike = res.data.filter((row) => row.install_id.startsWith('agent_'));
      const next = exists
        ? current
        : (agentLike[0]?.install_id ?? res.data[0]!.install_id);
      setActiveInstallId(next);
      setStoredInstallId(next);
      setActiveInstallIdState(next);
    }

    setLoading(false);
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
