import type { FormEvent, ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import BrandLogo from '@/components/BrandLogo';
import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import { storeAuthRedirect } from '@/lib/authRedirect';
import { INSTALL_ONE_LINER } from '@/lib/installScript';

interface AgentOnboardingProps {
  accountLabel: string | null;
  providerLabel: string | null;
  agentId: string;
  uploadSecret: string;
  fieldError: string | null;
  busy: boolean;
  showUploadSecret: boolean;
  /** 产品 Demo — 隐藏需登录后才看的帮助细节 */
  demoPreview?: boolean;
  /** 安装脚本预填提示 */
  prefillNotice?: string | null;
  onAgentIdChange: (value: string) => void;
  onUploadSecretChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onSignOut: () => void;
}

const ease = [0.22, 1, 0.36, 1] as const;
const CREDENTIALS_CMD = 'agentwatch-web3 credentials';

const LINKS = {
  node: 'https://nodejs.org/',
} as const;

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="agent-onboard__link">
      {children}
    </a>
  );
}

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

function StepIcon({ children }: { children: ReactNode }) {
  return <span className="agent-onboard__step-icon">{children}</span>;
}

function FlowStep({
  icon,
  title,
  children,
  last = false,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className={`agent-onboard__timeline-step${last ? ' agent-onboard__timeline-step--last' : ''}`}>
      <div className="agent-onboard__timeline-rail" aria-hidden>
        <StepIcon>{icon}</StepIcon>
        {!last && <span className="agent-onboard__timeline-line" />}
      </div>
      <div className="agent-onboard__timeline-content">
        <p className="agent-onboard__timeline-title">{title}</p>
        {children}
      </div>
    </li>
  );
}

function IconNode() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2L4 6.5v11L12 22l8-4.5v-11L12 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9l3 3-3 3M12 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v10m0 0 4-4m-4 4-4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l9 9m-3-3 3 3m-3-3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="4" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8H5a2 2 0 0 0-2 2v10h10v-1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
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
          <motion.div
            className="agent-onboard__rail"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: 0.85, ease, delay: 0.05 }}
            aria-hidden
          />

          <motion.header
            className="agent-onboard__brand"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
          >
            <BrandLogo to="/" size="md" showText={false} />
          </motion.header>

          <motion.div
            className="agent-onboard__panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.08 }}
          >
            <p className="agent-onboard__eyebrow">Setup</p>
            <h1 className="agent-onboard__title">添加你的 Agent</h1>
            <p className="agent-onboard__lead agent-onboard__lead--demo">
              登录后获得<strong>一键安装脚本</strong>与完整接入流程
            </p>

            <ol className="agent-onboard__demo-steps">
              <li className="agent-onboard__demo-step">
                <strong>1. 登录</strong>
                <span>GitHub 或 Wallet</span>
              </li>
              <li className="agent-onboard__demo-step">
                <strong>2. 运行脚本</strong>
                <span>一条命令安装 CLI，自动生成 Agent ID</span>
              </li>
              <li className="agent-onboard__demo-step">
                <strong>3. 接入</strong>
                <span>网页自动填好凭证，点接入即可</span>
              </li>
            </ol>

            <Link
              to="/auth"
              className="agent-onboard__submit agent-onboard__submit--link"
              onClick={() => storeAuthRedirect('/settings')}
            >
              登录开始
            </Link>

            <p className="agent-onboard__demo-hint agent-onboard__demo-hint--solo">
              安装命令、绑定表单与详细步骤，登录后在本页展示
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-onboard">
      <DashboardBackdrop />

      <div className="agent-onboard__shell">
        <motion.div
          className="agent-onboard__rail"
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: 0.85, ease, delay: 0.05 }}
          aria-hidden
        />

        <motion.header
          className="agent-onboard__brand"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <BrandLogo to="/" size="md" showText={false} />
        </motion.header>

        <motion.div
          className="agent-onboard__panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease, delay: 0.08 }}
        >
          <p className="agent-onboard__eyebrow">Setup</p>
          <h1 className="agent-onboard__title">添加你的 Agent</h1>
          <p className="agent-onboard__lead">本机运行一条命令 → 自动安装 CLI 并获得 Agent ID</p>

          <div className="agent-onboard__hero-cmd">
            <CmdRow cmd={INSTALL_ONE_LINER} />
            <p className="agent-onboard__hero-hint">
              脚本会复制凭证并打开本页；若未自动填入，运行下方 credentials 命令
            </p>
          </div>

          <form className="agent-onboard__form" onSubmit={handleSubmit} noValidate>
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

            {prefillNotice && !fieldError && (
              <p className="agent-onboard__prefill-notice">{prefillNotice}</p>
            )}

            <button type="submit" className="agent-onboard__submit" disabled={busy}>
              {busy ? '接入中…' : '接入 Agent'}
            </button>
          </form>

          <div className="agent-onboard__folds">
            <details className="agent-onboard__fold">
              <summary>完整流程</summary>
              <div className="agent-onboard__fold-body">
                <ol className="agent-onboard__timeline">
                  <FlowStep icon={<IconDownload />} title="一键安装（推荐）">
                    <CmdRow cmd={INSTALL_ONE_LINER} />
                    <p className="agent-onboard__timeline-sub">
                      自动安装 npm 包、生成 Agent ID，并打开 Dashboard 绑定页
                    </p>
                  </FlowStep>
                  <FlowStep icon={<IconNode />} title="或：安装 Node.js 18+">
                    <ExtLink href={LINKS.node}>nodejs.org</ExtLink>
                  </FlowStep>
                  <FlowStep icon={<IconTerminal />} title="打开命令行">
                    <p className="agent-onboard__timeline-sub">
                      Mac <kbd>⌘</kbd> <kbd>空格</kbd> 终端 · Win <kbd>Win</kbd> PowerShell
                    </p>
                  </FlowStep>
                  <FlowStep icon={<IconDownload />} title="手动安装 CLI（可选）">
                    <CmdRow cmd="npm install -g @agentwatch-web3/cli" />
                  </FlowStep>
                  <FlowStep icon={<IconKey />} title="初始化（可选）">
                    <CmdRow cmd="agentwatch-web3 init" />
                  </FlowStep>
                  <FlowStep icon={<IconClipboard />} title="复制凭证（若脚本未自动填入）">
                    <CmdRow cmd={CREDENTIALS_CMD} />
                  </FlowStep>
                  <FlowStep icon={<IconDashboard />} title="粘贴并接入 → 首页" last />
                </ol>
              </div>
            </details>

            <details className="agent-onboard__fold">
              <summary>已装过？</summary>
              <div className="agent-onboard__fold-body">
                <p className="agent-onboard__timeline-sub">运行 credentials 复制凭证，或重新执行一键安装脚本。</p>
                <CmdRow cmd={CREDENTIALS_CMD} />
              </div>
            </details>

            <details className="agent-onboard__fold">
              <summary>Agent ID 是什么</summary>
              <div className="agent-onboard__fold-body">
                <p className="agent-onboard__timeline-sub">本机安装编号，不是 GitHub 登录账号。</p>
              </div>
            </details>

            <details className="agent-onboard__fold">
              <summary>报错？</summary>
              <div className="agent-onboard__fold-body">
                <p className="agent-onboard__timeline-sub">
                  找不到命令 → <ExtLink href={LINKS.node}>装 Node.js</ExtLink>
                  <br />
                  无配置 → 先 <code>init</code>
                </p>
              </div>
            </details>
          </div>
        </motion.div>

        <motion.footer
          className="agent-onboard__footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, ease, delay: 0.15 }}
        >
          {providerLabel && <span className="agent-onboard__chip">{providerLabel}</span>}
          {accountLabel && <span className="agent-onboard__chip">{accountLabel}</span>}
          <button type="button" className="agent-onboard__signout" onClick={onSignOut}>
            退出登录
          </button>
        </motion.footer>
      </div>
    </div>
  );
}
