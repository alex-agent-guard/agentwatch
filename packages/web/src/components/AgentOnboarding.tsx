import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import BrandLogo from '@/components/BrandLogo';
import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import { storeAuthRedirect } from '@/lib/authRedirect';
import { parseCredentialsFromTerminal } from '@/lib/parseCredentials';
import { SETUP_AND_SHOW_ID_CMD, SHOW_AGENT_ID_CMD } from '@/lib/installScript';

interface AgentOnboardingProps {
  accountLabel: string | null;
  providerLabel: string | null;
  agentId: string;
  uploadSecret: string;
  fieldError: string | null;
  busy: boolean;
  showUploadSecret: boolean;
  demoPreview?: boolean;
  prefillNotice?: string | null;
  onAgentIdChange: (value: string) => void;
  onUploadSecretChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onSignOut: () => void;
}

const ease = [0.22, 1, 0.36, 1] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="agent-onboard__copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? '✓' : '复制'}
    </button>
  );
}

function CmdRow({ cmd }: { cmd: string }) {
  return (
    <div className="agent-onboard__cmd">
      <code className="agent-onboard__cmd-text">{cmd}</code>
      <CopyButton text={cmd} />
    </div>
  );
}

function MiniStep({ n, title, children }: { n: string; title: string; children?: ReactNode }) {
  return (
    <li className="agent-onboard__mini-step">
      <span className="agent-onboard__mini-num">{n}</span>
      <div className="agent-onboard__mini-body">
        <p className="agent-onboard__mini-title">{title}</p>
        {children}
      </div>
    </li>
  );
}

function PasteCredentialsButton({
  onPaste,
}: {
  onPaste: (agentId: string, uploadSecret: string) => void;
}) {
  const [hint, setHint] = useState<string | null>(null);

  return (
    <div className="agent-onboard__paste-row">
      <button
        type="button"
        className="agent-onboard__paste-btn"
        onClick={() => {
          void navigator.clipboard.readText().then((text) => {
            const parsed = parseCredentialsFromTerminal(text);
            if (!parsed) {
              setHint('剪贴板里没有 Agent ID，请先运行上方命令');
              window.setTimeout(() => setHint(null), 3000);
              return;
            }
            onPaste(parsed.agentId, parsed.uploadSecret);
            setHint('已填入');
            window.setTimeout(() => setHint(null), 2000);
          }).catch(() => {
            setHint('无法读取剪贴板，请手动粘贴');
            window.setTimeout(() => setHint(null), 3000);
          });
        }}
      >
        从剪贴板填入
      </button>
      {hint && <span className="agent-onboard__paste-hint">{hint}</span>}
    </div>
  );
}

export default function AgentOnboarding({
  accountLabel,
  providerLabel,
  agentId,
  uploadSecret,
  fieldError,
  busy,
  showUploadSecret,
  demoPreview = false,
  prefillNotice = null,
  onAgentIdChange,
  onUploadSecretChange,
  onSubmit,
  onSignOut,
}: AgentOnboardingProps) {
  const handleSubmit = (e: FormEvent) => {
    if (demoPreview) {
      e.preventDefault();
      storeAuthRedirect('/settings');
      window.location.hash = '#/auth';
      return;
    }
    onSubmit(e);
  };

  if (demoPreview) {
    return (
      <div className="agent-onboard">
        <DashboardBackdrop />
        <div className="agent-onboard__shell">
          <motion.header className="agent-onboard__brand" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <BrandLogo to="/" size="md" showText={false} />
          </motion.header>
          <motion.div className="agent-onboard__panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="agent-onboard__title">添加 Agent</h1>
            <p className="agent-onboard__lead agent-onboard__lead--demo">登录 → 终端复制命令 → 粘贴 Agent ID</p>
            <Link to="/auth" className="agent-onboard__submit agent-onboard__submit--link" onClick={() => storeAuthRedirect('/settings')}>
              登录开始
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-onboard">
      <DashboardBackdrop />

      <div className="agent-onboard__shell">
        <motion.header className="agent-onboard__brand" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <BrandLogo to="/" size="md" showText={false} />
        </motion.header>

        <motion.div
          className="agent-onboard__panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
        >
          <h1 className="agent-onboard__title">添加 Agent</h1>

          <ol className="agent-onboard__mini-steps">
            <MiniStep n="1" title="打开终端">
              <p className="agent-onboard__mini-line">
                按 <kbd>⌘</kbd> <kbd>空格</kbd> → 输入 <strong>终端</strong> → 回车
              </p>
            </MiniStep>

            <MiniStep n="2" title="粘贴运行，终端会打印本机 Agent ID">
              <CmdRow cmd={SETUP_AND_SHOW_ID_CMD} />
              <p className="agent-onboard__mini-line agent-onboard__mini-line--muted">
                装过 CLI 只需：<code>{SHOW_AGENT_ID_CMD}</code>
              </p>
            </MiniStep>

            <MiniStep n="3" title="登录网页后会自动记录；没自动填再手动粘贴">
              <form className="agent-onboard__form agent-onboard__form--compact" onSubmit={handleSubmit} noValidate>
                <PasteCredentialsButton
                  onPaste={(id, secret) => {
                    onAgentIdChange(id);
                    if (secret) {
                      onUploadSecretChange(secret);
                    }
                  }}
                />

                <label className="agent-onboard__field">
                  <span className="agent-onboard__label">Agent ID</span>
                  <input
                    value={agentId}
                    onChange={(e) => onAgentIdChange(e.target.value)}
                    className={`agent-onboard__input${fieldError && !agentId.trim() ? ' agent-onboard__input--invalid' : ''}`}
                    placeholder="agent_xxxxxxxxxxxx"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>

                {showUploadSecret && (
                  <label className="agent-onboard__field">
                    <span className="agent-onboard__label">上传密钥</span>
                    <input
                      value={uploadSecret}
                      onChange={(e) => onUploadSecretChange(e.target.value)}
                      className={`agent-onboard__input${fieldError && !uploadSecret.trim() ? ' agent-onboard__input--invalid' : ''}`}
                      placeholder="aw_xxxxxxxxxxxxxxxx"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                )}

                {fieldError && <p className="agent-onboard__error">{fieldError}</p>}
                {prefillNotice && !fieldError && <p className="agent-onboard__prefill-notice">{prefillNotice}</p>}

                <button type="submit" className="agent-onboard__submit" disabled={busy}>
                  {busy ? '接入中…' : '接入'}
                </button>
              </form>
            </MiniStep>
          </ol>
        </motion.div>

        <motion.footer className="agent-onboard__footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {providerLabel && <span className="agent-onboard__chip">{providerLabel}</span>}
          {accountLabel && <span className="agent-onboard__chip">{accountLabel}</span>}
          <button type="button" className="agent-onboard__signout" onClick={onSignOut}>
            退出
          </button>
        </motion.footer>
      </div>
    </div>
  );
}
