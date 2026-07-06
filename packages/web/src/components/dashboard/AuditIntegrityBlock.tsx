import { useState } from 'react';
import CopyButton from '@/components/ui/CopyButton';
import type { AgentWatchEvent } from '@/types/events';
import {
  computeHmacIntegrity,
  downloadEvidenceJson,
  integrityStatusEmoji,
  integrityStatusLabel,
  shortHmac,
} from '@/lib/auditDetail';

interface AuditIntegrityBlockProps {
  event: AgentWatchEvent;
  sessionRows: AgentWatchEvent[];
}

export default function AuditIntegrityBlock({ event, sessionRows }: AuditIntegrityBlockProps) {
  const [exported, setExported] = useState(false);
  const integrity = computeHmacIntegrity(event, sessionRows);
  const chainPosition =
    event.sequence_no !== undefined && event.sequence_no !== null
      ? String(event.sequence_no)
      : null;

  const handleExport = () => {
    downloadEvidenceJson(event);
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
            <CopyButton text={event.hmac} title="复制完整 HMAC" className="dash-audit-detail__copy" />
          </dd>
        </div>
        {event.prev_hmac?.trim() && (
          <div className="dash-integrity-grid__row">
            <dt>prev_hmac</dt>
            <dd>
              <code className="dash-integrity-hash">{shortHmac(event.prev_hmac)}</code>
              <CopyButton text={event.prev_hmac.trim()} title="复制完整 prev_hmac" className="dash-audit-detail__copy" />
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
