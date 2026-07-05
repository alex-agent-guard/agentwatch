import type { CSSProperties } from 'react';
import { useState } from 'react';
import { isGuestMode, isLiveDataMode, shouldUseDemoData } from '@/lib/session';

interface DashboardHeaderProps {
  installId: string;
  error: string | null;
  lastUpdated: Date | null;
  refreshing: boolean;
  liveMode: boolean;
  onRefresh: () => void;
}

function truncateId(id: string, max = 14): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function DashboardHeader({
  installId,
  error,
  lastUpdated,
  refreshing,
  liveMode,
  onRefresh,
}: DashboardHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(installId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <header className="dash-header dash-header--page dash-enter" style={{ '--dash-delay': '0ms' } as CSSProperties}>
      <div className="dash-header__top">
        <div className="dash-header__lead">
          <span className="dash-header__eyebrow">Security Console</span>
          <h1 className="dash-header__title">安全仪表盘</h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="dash-glass dash-header__refresh dash-glass--lift"
          aria-label="刷新数据"
        >
          <svg
            className={refreshing ? 'dash-header__refresh-icon--spin' : ''}
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

      <div className="dash-header__meta">
        <button
          type="button"
          onClick={() => void copyId()}
          className="dash-glass dash-header__id dash-glass--lift"
          title={`${installId} — 点击复制`}
        >
          {copied ? '已复制' : truncateId(installId)}
        </button>
        {liveMode && isLiveDataMode() && (
          <span className="dash-header__live">
            <span className="dash-header__live-dot" />
            Live
          </span>
        )}
        {shouldUseDemoData() && (
          <span className="dash-header__badge">{isGuestMode() ? 'Guest' : 'Demo'}</span>
        )}
        {lastUpdated && (
          <span className="dash-header__time">
            {lastUpdated.toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>

      {error && <p className="dash-header__error">连接异常 — 请检查 install_id</p>}
    </header>
  );
}
