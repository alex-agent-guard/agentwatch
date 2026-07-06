import { useState } from 'react';
import type { AgentWatchEvent } from '@/types/events';
import {
  computeHmacIntegrity,
  exportEvidenceJson,
  integrityStatusEmoji,
  integrityStatusLabel,
  shortHmac,
} from '@/lib/auditDetail';

interface AuditIntegrityBlockProps {
  event: AgentWatchEvent;
  sessionRows: AgentWatchEvent[];
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.5 10.5h-1a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3.5 1.5h6A1.5 1.5 0 0 1 11 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AuditIntegrityBlock({ event, sessionRows }: AuditIntegrityBlockProps) {
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const integrity = computeHmacIntegrity(event, sessionRows);
  const chainPosition =
    event.sequence_no !== undefined && event.sequence_no !== null
      ? String(event.sequence_no)
      : null;

  const handleCopyHmac = () => {
    void navigator.clipboard.writeText(event.hmac).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExport = () => {
    const blob = new Blob([exportEvidenceJson(event)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `agentwatch-${event.event_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  };

  return (
    <section className="dash-audit-section dash-audit-section--integrity">
      <div className="dash-audit-section__head">
        <h4 className="dash-audit-section__title">链式验真</h4>
        <span className={`dash-integrity-badge dash-integrity-badge--${integrity.status}`}>
          {integrityStatusEmoji(integrity.status)} {integrityStatusLabel(integrity.status)}
        </span>
      </div>

      <p className="dash-audit-detail__note">{integrity.detail}</p>

      <dl className="dash-integrity-grid">
        <div className="dash-integrity-grid__row">
          <dt>hmac</dt>
          <dd>
            <code className="dash-integrity-hash">{shortHmac(event.hmac)}</code>
            <button
              type="button"
              className="dash-audit-detail__copy"
              onClick={handleCopyHmac}
              title="复制完整 HMAC"
            >
              {copied ? '已复制' : <CopyIcon />}
            </button>
          </dd>
        </div>
        {event.prev_hmac?.trim() && (
          <div className="dash-integrity-grid__row">
            <dt>prev_hmac</dt>
            <dd>
              <code className="dash-integrity-hash">{shortHmac(event.prev_hmac)}</code>
            </dd>
          </div>
        )}
        {chainPosition && (
          <div className="dash-integrity-grid__row">
            <dt>序号</dt>
            <dd className="dash-risk-tier__fact-mono">{chainPosition}</dd>
          </div>
        )}
      </dl>

      <div className="dash-integrity-actions">
        <button type="button" className="dash-text-btn" onClick={handleExport}>
          {exported ? '已下载' : '导出证据 JSON'}
        </button>
        <a
          className="dash-text-btn dash-text-btn--link"
          href="https://github.com/agentwatch/agentwatch#audit-verify"
          target="_blank"
          rel="noreferrer"
        >
          CLI 验证文档
        </a>
      </div>
    </section>
  );
}
