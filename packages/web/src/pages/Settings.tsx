import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useState } from 'react';
import DashPageHeader from '@/components/dashboard/DashPageHeader';
import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import MobileTabBar from '@/components/dashboard/MobileTabBar';
import Sidebar from '@/components/dashboard/Sidebar';
import { useActiveInstall } from '@/hooks/useActiveInstall';
import { formatAccountLabel, getCurrentUser, signOut } from '@/lib/auth';
import { clearGuestMode, isGuestMode, isLiveDataMode, shouldUseDemoData } from '@/lib/session';
import { bindInstallId, registerUploadSecret, removeUserAgent } from '@/lib/userAgents';
import { setActiveInstallId } from '@/types/events';

export default function Settings() {
  const { agents, activeInstallId, loading, error, refreshAgents, selectInstallId } =
    useActiveInstall();

  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const guest = isGuestMode();
  const [agentId, setAgentId] = useState('');
  const [uploadSecret, setUploadSecret] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (guest) {
      setAccountLabel('游客');
      return;
    }
    void getCurrentUser().then((user) => setAccountLabel(formatAccountLabel(user)));
  }, [guest]);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 3000);
  };

  const handleAddAgent = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedId = agentId.trim();
    if (!trimmedId) {
      setFieldError('请填写 Agent ID');
      return;
    }
    if (!shouldUseDemoData() && !uploadSecret.trim()) {
      setFieldError('请填写上传密钥');
      return;
    }
    setFieldError(null);
    setBusy(true);

    const bindRes = await bindInstallId(trimmedId, '我的 Agent');
    if (bindRes.error || !bindRes.data) {
      setBusy(false);
      flash(bindRes.error ?? '添加失败');
      return;
    }

    if (uploadSecret.trim() && !shouldUseDemoData()) {
      const secretRes = await registerUploadSecret(bindRes.data.install_id, uploadSecret);
      if (secretRes.error || !secretRes.ok) {
        setBusy(false);
        flash(secretRes.error ?? '密钥保存失败');
        return;
      }
    }

    setAgentId('');
    setUploadSecret('');
    setActiveInstallId(bindRes.data.install_id);
    await refreshAgents();
    selectInstallId(bindRes.data.install_id);
    setBusy(false);
    flash('Agent 已接入');
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

  const dataModeLabel = shouldUseDemoData() ? '演示' : '实时';

  return (
    <div className="relative flex min-h-screen">
      <DashboardBackdrop />
      <Sidebar />
      <MobileTabBar />

      <main className="dash-main relative z-10">
        <DashPageHeader title="设置" variant="page" eyebrow="Settings" />

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
              <span className="dash-settings-chip">{accountLabel ?? '—'}</span>
              <span
                className={`dash-settings-pill ${shouldUseDemoData() ? 'dash-settings-pill--demo' : 'dash-settings-pill--live'}`}
              >
                {isLiveDataMode() && <span className="dash-settings-pill__dot" aria-hidden />}
                {dataModeLabel}
              </span>
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
                终端运行 <span className="dash-settings__mono">agentwatch init</span>，粘贴 ID 与密钥即可接入。
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
        </section>
      </main>
    </div>
  );
}
