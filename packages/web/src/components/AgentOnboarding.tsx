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
  const credentialsReady =
    agentId.trim().length > 0 && (!showUploadSecret || uploadSecret.trim().length > 0);
  const hasPrefill = Boolean(prefillNotice) || credentialsReady;

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
          <p className="agent-onboard__lead">
            共 3 步：<strong>本机终端装 CLI</strong> → <strong>网页确认凭证</strong> → <strong>接入完成</strong>
          </p>

          <ol className="agent-onboard__guide">
            <li
              className={`agent-onboard__guide-step${hasPrefill ? ' agent-onboard__guide-step--done' : ' agent-onboard__guide-step--active'}`}
            >
              <div className="agent-onboard__guide-head">
                <span className="agent-onboard__guide-num" aria-hidden>
                  {hasPrefill ? '✓' : '1'}
                </span>
                <div>
                  <p className="agent-onboard__guide-title">在本 Mac 打开终端，运行安装命令</p>
                  <p className="agent-onboard__guide-desc">
                    会自动安装 CLI、生成本机 Agent ID，并尝试打开本页填入凭证。
                    <strong> 这一步在终端完成，不是在浏览器里点。</strong>
                  </p>
                </div>
              </div>
              <CmdRow cmd={INSTALL_ONE_LINER} />
              <p className="agent-onboard__guide-tip">
                打开终端：Mac 按 <kbd>⌘</kbd> <kbd>空格</kbd>，输入「终端」回车。需要 Node.js 18+，没有请先装{' '}
                <ExtLink href={LINKS.node}>nodejs.org</ExtLink>
              </p>
            </li>

            <li
              className={`agent-onboard__guide-step${
                credentialsReady
                  ? ' agent-onboard__guide-step--done'
                  : hasPrefill
                    ? ' agent-onboard__guide-step--active'
                    : ''
              }`}
            >
              <div className="agent-onboard__guide-head">
                <span className="agent-onboard__guide-num" aria-hidden>
                  {credentialsReady ? '✓' : '2'}
                </span>
                <div>
                  <p className="agent-onboard__guide-title">回到本页，确认 Agent ID 与上传密钥</p>
                  <p className="agent-onboard__guide-desc">
                    脚本成功后会自动填入；若仍是空的，在终端运行{' '}
                    <code className="agent-onboard__inline-code">{CREDENTIALS_CMD}</code> 再粘贴。
                  </p>
                </div>
              </div>

              <form className="agent-onboard__form agent-onboard__form--guide" onSubmit={handleSubmit} noValidate>
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

                {!credentialsReady && (
                  <div className="agent-onboard__guide-fallback">
                    <p className="agent-onboard__guide-fallback-label">字段还是空的？在终端运行：</p>
                    <CmdRow cmd={CREDENTIALS_CMD} />
                  </div>
                )}

                {fieldError && <p className="agent-onboard__error">{fieldError}</p>}

                {prefillNotice && !fieldError && (
                  <p className="agent-onboard__prefill-notice">{prefillNotice}</p>
                )}

                <div className="agent-onboard__guide-step3">
                  <div className="agent-onboard__guide-head agent-onboard__guide-head--inline">
                    <span className="agent-onboard__guide-num" aria-hidden>
                      3
                    </span>
                    <p className="agent-onboard__guide-title">点击接入，绑定到当前登录账户</p>
                  </div>
                  <button type="submit" className="agent-onboard__submit" disabled={busy}>
                    {busy ? '接入中…' : '接入 Agent → 进入首页'}
                  </button>
                  <p className="agent-onboard__guide-tip agent-onboard__guide-tip--submit">
                    接入成功后会把本机 Agent 绑到你刚登录的账户，并跳转到监控首页。
                  </p>
                </div>
              </form>
            </li>
          </ol>

          <div className="agent-onboard__folds">
            <details className="agent-onboard__fold">
              <summary>已装过 CLI？ / 脚本报错？</summary>
              <div className="agent-onboard__fold-body">
                <p className="agent-onboard__timeline-sub">
                  <strong>已经装过：</strong>终端运行 <code>agentwatch-web3 credentials</code>，复制输出粘贴到上方表单。
                </p>
                <CmdRow cmd={CREDENTIALS_CMD} />
                <p className="agent-onboard__timeline-sub">
                  <strong>找不到命令：</strong>先装 <ExtLink href={LINKS.node}>Node.js 18+</ExtLink>，或手动执行{' '}
                  <code>npm install -g @agentwatch-web3/cli</code> 后再 <code>agentwatch-web3 init</code>。
                </p>
                <CmdRow cmd="npm install -g @agentwatch-web3/cli" />
                <CmdRow cmd="agentwatch-web3 init" />
              </div>
            </details>

            <details className="agent-onboard__fold">
              <summary>Agent ID 是什么？和 GitHub 账号一样吗？</summary>
              <div className="agent-onboard__fold-body">
                <p className="agent-onboard__timeline-sub">
                  Agent ID 是<strong>你这台 Mac 上 CLI 生成的本机编号</strong>，用来把本机上报的数据绑到当前网页账户。
                  它不是 GitHub / 钱包登录名，每个设备可以有不同的 Agent ID。
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
