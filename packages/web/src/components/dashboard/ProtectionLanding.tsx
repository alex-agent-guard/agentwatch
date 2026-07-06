import { Link } from 'react-router-dom';
import { useState } from 'react';
import ClientServiceMatrix from '@/components/dashboard/ClientServiceMatrix';
import ProtectionDemoScenarios from '@/components/dashboard/ProtectionDemoScenarios';
import type { DemoScenario } from '@/data/mockData';
import ProtectionHeroStatus from '@/components/dashboard/ProtectionHeroStatus';
import ProtectionHeroVisual from '@/components/dashboard/ProtectionHeroVisual';
import RecentActivity from '@/components/dashboard/RecentActivity';
import {
  getClientServiceLinks,
  getRecentActivity,
  hasIdentityGap,
} from '@/lib/activityStats';
import type { AgentWatchEvent } from '@/types/events';
import { getProtectionTone } from '@/lib/protectionStatus';

interface ProtectionLandingProps {
  installId: string;
  events: AgentWatchEvent[];
  refreshing: boolean;
  lastUpdated: Date | null;
  error: string | null;
  onRefresh: () => void;
  onOpenFullDashboard: () => void;
  /** Demo 模式 — 展示场景切换 */
  demoScenario?: DemoScenario;
  onDemoScenarioChange?: (next: DemoScenario) => void;
}

/** Live 保护态 — 统一卡片：视频 + 状态 + 活动 */
export default function ProtectionLanding({
  installId,
  events,
  refreshing,
  lastUpdated,
  error,
  onRefresh,
  onOpenFullDashboard,
  demoScenario,
  onDemoScenarioChange,
}: ProtectionLandingProps) {
  const hasEvents = events.length > 0;
  const warnCount = events.filter((e) => e.final_decision === 'WARN').length;
  const blockCount = events.filter((e) => e.final_decision === 'BLOCK').length;
  const tone = getProtectionTone(blockCount, warnCount);
  const isHealthyIdle = !hasEvents;
  const links = getClientServiceLinks(events);
  const recent = getRecentActivity(events);
  const identityGap = hasIdentityGap(events);
  const [videoMuted, setVideoMuted] = useState(true);

  return (
    <div className="protect-landing">
      <article className={`protect-shell dash-glass dash-enter protect-shell--${tone}`}>
        {error && <p className="protect-shell__error">{error} — 请检查 Agent 绑定</p>}

        <div className="protect-shell__cinema">
          <ProtectionHeroVisual muted={videoMuted} tone={tone} />
          <div className="protect-shell__cinema-scrim" aria-hidden />

          <div className="protect-shell__cinema-head">
            <div className="protect-shell__cinema-head-start">
              <Link to="/" className="protect-shell__back">
                back
              </Link>
              <span className="protect-shell__eyebrow">安全中心</span>
            </div>
            <div className="protect-shell__actions">
              {tone === 'healthy' && (
                <button
                  type="button"
                  className="protect-shell__icon-btn protect-shell__icon-btn--float"
                  onClick={() => setVideoMuted((m) => !m)}
                  aria-label={videoMuted ? '开启视频声音' : '关闭视频声音'}
                  aria-pressed={!videoMuted}
                >
                  {videoMuted ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3 6.5v3h2.5L9 13V3L5.5 6.5H3z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M11.5 5.5L14 8m0 0l-2.5 2.5M14 8l-2.5-2.5M14 8l2.5 2.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3 6.5v3h2.5L9 13V3L5.5 6.5H3z"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M11 6.5c.9.75 1.5 1.85 1.5 3s-.6 2.25-1.5 3"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
              )}
              <button
                type="button"
                className="protect-shell__icon-btn protect-shell__icon-btn--float"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="刷新数据"
              >
                <svg
                  className={refreshing ? 'protect-shell__spin' : ''}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M13.65 8.5A5.65 5.65 0 1 1 8 2.35V4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M8 1v3h3"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <ProtectionHeroStatus
            installId={installId}
            auditCount={events.length}
            warnCount={warnCount}
            blockCount={blockCount}
            hasEvents={hasEvents}
          />
        </div>

        <div className="protect-shell__main">
          {demoScenario !== undefined && onDemoScenarioChange !== undefined && (
            <ProtectionDemoScenarios value={demoScenario} onChange={onDemoScenarioChange} />
          )}

          {identityGap && hasEvents && (
            <p className="protect-panel__notice protect-panel__notice--inline">
              部分记录信息不完整，请确认本机程序已更新并重新启动。
            </p>
          )}

          {hasEvents && <ClientServiceMatrix links={links} />}

          {hasEvents && <RecentActivity items={recent} listening={false} />}

          {isHealthyIdle && (
            <section className="protect-ready-card dash-enter" aria-label="接入后下一步">
              <div className="protect-ready-card__accent" aria-hidden />
              <div className="protect-ready-card__head">
                <span className="protect-ready-card__step">下一步</span>
                <h3 className="protect-ready-card__title">重启 Cursor 或 Claude</h3>
                <p className="protect-ready-card__desc">
                  一键安装脚本已写入 MCP 配置。请完全退出并重新打开 IDE，代理才会开始拦截与审计。
                </p>
              </div>
              <ul className="protect-ready-card__notes">
                <li>一切正常 = 暂无警告或拦截，说明 Agent 运行安全</li>
                <li>云端仅展示警告与拦截；正常放行不会出现在此页</li>
                <li>出现注意项或拦截后，agent 行为记录与最近动态会自动更新</li>
              </ul>
            </section>
          )}

          <footer className="protect-shell__foot">
            {isHealthyIdle ? (
              <span className="protect-shell__time protect-shell__time--healthy">
                绑定成功 · 汐底持续守护中
                {lastUpdated &&
                  ` · 更新于 ${lastUpdated.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`}
              </span>
            ) : (
              lastUpdated && (
                <span className={`protect-shell__time protect-shell__time--${tone}`}>
                  {tone === 'healthy'
                    ? '汐底持续守护中'
                    : tone === 'warn'
                      ? '有操作需要你留意'
                      : '已拦截可疑操作'}
                  {' · '}
                  更新于{' '}
                  {lastUpdated.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                  · 每 10 秒自动刷新
                </span>
              )
            )}
            {hasEvents && (
              <button type="button" className="protect-shell__full" onClick={onOpenFullDashboard}>
                查看全部数据
              </button>
            )}
          </footer>
        </div>
      </article>
    </div>
  );
}
