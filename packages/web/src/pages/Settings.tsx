import type { CSSProperties, FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AgentOnboarding from '@/components/AgentOnboarding';
import AppShell from '@/components/dashboard/AppShell';
import BrandLogo from '@/components/BrandLogo';
import { useActiveInstall } from '@/hooks/useActiveInstall';
import {
  consumeAgentBindPrefill,
  consumeAutoBindAfterLogin,
  parseBindPrefillFromSearch,
} from '@/lib/agentBindPrefill';
import { formatAccountLabel, getAuthProvider, getCurrentUser, signOut } from '@/lib/auth';
import { fetchLiveEntitlementStatus, type LiveEntitlementStatus } from '@/lib/liveEntitlement';
import { isLiveGateEnabled } from '@/lib/liveGate';
import { clearGuestMode, isGuestMode, isLiveDataMode, shouldUseDemoData } from '@/lib/session';
import { bindInstallId, registerUploadSecret, removeUserAgent } from '@/lib/userAgents';
import { setActiveInstallId } from '@/types/events';

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agents, activeInstallId, loading, error, refreshAgents, selectInstallId } =
    useActiveInstall();

  const previewOnboarding =
    import.meta.env.DEV && searchParams.get('preview') === 'onboarding';

  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const guest = isGuestMode() && shouldUseDemoData();
  const [agentId, setAgentId] = useState('');
  const [uploadSecret, setUploadSecret] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installPrefillNote, setInstallPrefillNote] = useState<string | null>(null);
  const [autoBinding, setAutoBinding] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveEntitlementStatus | null>(null);
  const autoBindStarted = useRef(false);

  const liveGate = isLiveGateEnabled();
  const isOnboarding =
    previewOnboarding || (isLiveDataMode() && !loading && agents.length === 0 && !autoBinding);

  useEffect(() => {
    if (!liveGate || guest) {
      return;
    }
    void fetchLiveEntitlementStatus().then(setLiveStatus);
  }, [liveGate, guest]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3000);
  }, []);

  useEffect(() => {
    const fromUrl = parseBindPrefillFromSearch(`?${searchParams.toString()}`);
    const fromStore = fromUrl === null ? consumeAgentBindPrefill() : null;
    const prefill = fromUrl ?? fromStore;
    if (prefill === null) {
      return;
    }
    if (prefill.agentId) {
      setAgentId(prefill.agentId);
    }
    if (prefill.uploadSecret) {
      setUploadSecret(prefill.uploadSecret);
    }
    const canAutoBind = Boolean(prefill.agentId && prefill.uploadSecret);
    if (canAutoBind && (fromUrl !== null || consumeAutoBindAfterLogin())) {
      setAutoBinding(true);
      setInstallPrefillNote('正在自动接入本机 Agent…');
    } else if (prefill.agentId || prefill.uploadSecret) {
      setInstallPrefillNote('已填入，点「接入」即可');
    }
    if (searchParams.toString()) {
      navigate('/settings', { replace: true });
    }
  }, [navigate, searchParams]);

  const performAgentBind = useCallback(
    async (trimmedId: string, secret: string, navigateHomeAfter: boolean) => {
      setFieldError(null);
      setBusy(true);

      const existing = agents.find((row) => row.install_id === trimmedId);
      if (existing) {
        setActiveInstallId(existing.install_id);
        selectInstallId(existing.install_id);
        setAgentId('');
        setUploadSecret('');
        setBusy(false);
        setAutoBinding(false);
        if (navigateHomeAfter) {
          navigate('/home', { replace: true });
        }
        return;
      }

      const bindRes = await bindInstallId(trimmedId, '我的 Agent');
      if (bindRes.error || !bindRes.data) {
        setBusy(false);
        setAutoBinding(false);
        setInstallPrefillNote(null);
        flash(bindRes.error ?? '添加失败');
        return;
      }

      if (secret && !shouldUseDemoData()) {
        const secretRes = await registerUploadSecret(bindRes.data.install_id, secret);
        if (secretRes.error || !secretRes.ok) {
          setBusy(false);
          setAutoBinding(false);
          setInstallPrefillNote(null);
          flash(secretRes.error ?? '密钥保存失败');
          return;
        }
      }

      setAgentId('');
      setUploadSecret('');
      setInstallPrefillNote(null);
      setActiveInstallId(bindRes.data.install_id);
      await refreshAgents();
      selectInstallId(bindRes.data.install_id);
      setBusy(false);
      setAutoBinding(false);

      if (navigateHomeAfter) {
        navigate('/home', { replace: true });
        return;
      }
      flash('Agent 已接入');
    },
    [agents, flash, navigate, refreshAgents, selectInstallId],
  );

  useEffect(() => {
    if (autoBindStarted.current || !autoBinding || loading) {
      return;
    }
    const trimmedId = agentId.trim();
    const secret = uploadSecret.trim();
    if (!trimmedId) {
      return;
    }
    if (!shouldUseDemoData() && !secret) {
      return;
    }

    autoBindStarted.current = true;
    void performAgentBind(trimmedId, secret, true);
  }, [autoBinding, agentId, uploadSecret, loading, performAgentBind]);

  useEffect(() => {
    if (guest) {
      setAccountLabel('Dev Mock');
      setProviderLabel(null);
      return;
    }
    void getCurrentUser().then((user) => {
      setAccountLabel(formatAccountLabel(user));
      const provider = getAuthProvider(user);
      setProviderLabel(provider === 'github' ? 'GitHub' : provider === 'wallet' ? 'Wallet' : null);
    });
  }, [guest]);

  const handleAddAgent = async (e: FormEvent) => {
    e.preventDefault();
    if (previewOnboarding) {
      return;
    }
    const trimmedId = agentId.trim();
    if (!trimmedId) {
      setFieldError('请填写 Agent ID');
      return;
    }
    if (!shouldUseDemoData() && !uploadSecret.trim()) {
      setFieldError('请填写上传密钥');
      return;
    }
    await performAgentBind(trimmedId, uploadSecret.trim(), isOnboarding);
  };

  const handleRemove = async (installId: string) => {
    setBusy(true);
    const res = await removeUserAgent(installId);
    setBusy(false);
    if (res.error) {
      flash(res.error);
      return;
    }
    await refreshAgents();
    flash('已移除');
  };

  const handleSignOut = async () => {
    if (guest) {
      clearGuestMode();
      window.location.hash = '#/auth';
      return;
    }
    await signOut();
    window.location.hash = '#/auth';
  };

  if ((loading || autoBinding) && isLiveDataMode() && !previewOnboarding && agents.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#131a26] text-sm text-white/60">
        {autoBinding ? '正在自动接入 Agent…' : '正在加载…'}
      </div>
    );
  }

  if (isOnboarding) {
    return (
      <>
        {previewOnboarding && (
          <p className="agent-onboard-preview-badge" role="status">
            产品体验 — 登录后新用户会自动看到此页
          </p>
        )}
        <AgentOnboarding
        accountLabel={accountLabel}
        providerLabel={providerLabel}
        agentId={agentId}
        uploadSecret={uploadSecret}
        fieldError={fieldError}
        busy={busy}
        prefillNotice={installPrefillNote}
        showUploadSecret={!shouldUseDemoData()}
        onAgentIdChange={(value) => {
          setAgentId(value);
          if (fieldError) setFieldError(null);
        }}
        onUploadSecretChange={(value) => {
          setUploadSecret(value);
          if (fieldError) setFieldError(null);
        }}
        onSubmit={(e) => void handleAddAgent(e)}
        onSignOut={() => void handleSignOut()}
        />
      </>
    );
  }

  const dataModeLabel = shouldUseDemoData() ? '演示' : '实时';

  return (
    <AppShell>
      <header
        className="dash-settings-hero dash-enter"
        style={{ '--dash-delay': '0ms' } as CSSProperties}
      >
        <BrandLogo to="/" showText className="dash-settings-hero__brand" />
        <p className="dash-settings-hero__label">设置</p>
      </header>

        {status && (
          <p className="dash-settings-footnote dash-enter" style={{ color: '#8fd4a8' }}>
            {status}
          </p>
        )}
        {error && (
          <p className="dash-settings-footnote dash-enter" style={{ color: '#ff8a8a' }}>
            {error}
          </p>
        )}

        <section
          className="dash-glass dash-panel dash-settings-panel dash-enter"
          style={{ '--dash-delay': '60ms' } as CSSProperties}
          aria-label="Account settings"
        >
          <div className="dash-settings-row dash-settings-row--last">
            <div className="dash-settings-row__meta">
              <h2 className="dash-settings-row__title">账户</h2>
            </div>
            <div className="dash-settings-row__control">
              {providerLabel && (
                <span className="dash-settings-chip dash-settings-chip--muted">{providerLabel}</span>
              )}
              <span className="dash-settings-chip">{accountLabel ?? '—'}</span>
              <span
                className={`dash-settings-pill ${shouldUseDemoData() ? 'dash-settings-pill--demo' : 'dash-settings-pill--live'}`}
              >
                {isLiveDataMode() && <span className="dash-settings-pill__dot" aria-hidden />}
                {dataModeLabel}
              </span>
              {liveGate && liveStatus?.entitled && (
                <span className="dash-settings-chip dash-settings-chip--live">已激活</span>
              )}
              <button type="button" onClick={() => void handleSignOut()} className="dash-ghost-btn">
                {guest ? '退出' : '退出登录'}
              </button>
              {guest && (
                <a href="#/auth" className="dash-ghost-btn" onClick={() => clearGuestMode()}>
                  登录
                </a>
              )}
            </div>
          </div>
        </section>

        <section
          className="dash-glass dash-panel dash-settings-panel dash-enter"
          style={{ '--dash-delay': '120ms' } as CSSProperties}
          aria-label="My agents"
        >
          <div className="dash-settings-row dash-settings-row--stack">
            <div className="dash-settings-row__meta">
              <h2 className="dash-settings-row__title">我的 Agent</h2>
              <p className="dash-settings-row__desc">
                {agents.length > 0
                  ? '已记录本机 Agent，Dashboard 只展示当前设备数据。'
                  : '终端运行 agentwatch-web3 credentials，会自动接入。'}
              </p>
            </div>
          </div>

          {loading ? (
            <p className="dash-settings-footnote dash-settings-footnote--inset">加载中…</p>
          ) : agents.length === 0 ? (
            <p className="dash-settings-footnote dash-settings-footnote--inset">还没有 Agent</p>
          ) : (
            <ul className="dash-settings-agents">
              {agents.map((agent) => {
                const active = agent.install_id === activeInstallId;
                return (
                  <li key={agent.id} className="dash-settings-agent">
                    <button
                      type="button"
                      onClick={() => selectInstallId(agent.install_id)}
                      className={`dash-settings-agent__select${active ? ' dash-settings-agent__select--active' : ''}`}
                    >
                      <span className="dash-settings-agent__name">{agent.label}</span>
                      <span className="dash-settings-agent__id">{agent.install_id}</span>
                      {active && <span className="dash-settings-agent__mark">当前</span>}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRemove(agent.install_id)}
                      className="dash-settings-agent__remove"
                    >
                      移除
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {agents.length === 0 ? (
            <form onSubmit={(e) => void handleAddAgent(e)} className="dash-settings-add" noValidate>
              <input
                value={agentId}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                className={`dash-input dash-input--plain dash-input--settings${fieldError && !agentId.trim() ? ' dash-input--invalid' : ''}`}
                placeholder="Agent ID"
                spellCheck={false}
                autoComplete="off"
              />
              {!shouldUseDemoData() && (
                <input
                  value={uploadSecret}
                  onChange={(e) => {
                    setUploadSecret(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  className={`dash-input dash-input--plain dash-input--settings${fieldError && !uploadSecret.trim() ? ' dash-input--invalid' : ''}`}
                  placeholder="上传密钥"
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
              {fieldError && <p className="dash-field-hint">{fieldError}</p>}
              <button type="submit" disabled={busy} className="dash-ghost-btn dash-settings-save">
                添加
              </button>
            </form>
          ) : (
            <details className="dash-settings-add-more">
              <summary>添加另一台设备</summary>
              <form onSubmit={(e) => void handleAddAgent(e)} className="dash-settings-add" noValidate>
                <input
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  className={`dash-input dash-input--plain dash-input--settings${fieldError && !agentId.trim() ? ' dash-input--invalid' : ''}`}
                  placeholder="Agent ID"
                  spellCheck={false}
                  autoComplete="off"
                />
                {!shouldUseDemoData() && (
                  <input
                    value={uploadSecret}
                    onChange={(e) => {
                      setUploadSecret(e.target.value);
                      if (fieldError) setFieldError(null);
                    }}
                    className={`dash-input dash-input--plain dash-input--settings${fieldError && !uploadSecret.trim() ? ' dash-input--invalid' : ''}`}
                    placeholder="上传密钥"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
                {fieldError && <p className="dash-field-hint">{fieldError}</p>}
                <button type="submit" disabled={busy} className="dash-ghost-btn dash-settings-save">
                  添加
                </button>
              </form>
            </details>
          )}
        </section>
    </AppShell>
  );
}
