import { useEffect, useMemo, useState } from 'react';
import AuditRiskAccordion from '@/components/dashboard/AuditRiskAccordion';
import AuditIntegrityBlock from '@/components/dashboard/AuditIntegrityBlock';
import AuditRiskBrief from '@/components/dashboard/AuditRiskBrief';
import SessionTimeline from '@/components/dashboard/SessionTimeline';
import { fetchSessionEvents } from '@/lib/events';
import {
  hasTraceContext,
  isGrayRhinoEvent,
  traceContextFields,
} from '@/lib/auditDetail';
import { buildEventRiskBrief } from '@/lib/auditRiskBrief';
import type { AgentWatchEvent } from '@/types/events';
import { decisionColor, formatTimestamp } from '@/types/events';

interface AuditEventDetailProps {
  event: AgentWatchEvent;
  onClose?: () => void;
  compact?: boolean;
  onSelectEvent?: (event: AgentWatchEvent) => void;
}

function FactGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="dash-risk-tier__fact-grid">
      {rows.map((row) => (
        <div key={row.label} className="dash-risk-tier__fact-row">
          <dt>{row.label}</dt>
          <dd className="dash-risk-tier__fact-mono">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AuditEventDetail({
  event,
  onClose,
  compact,
  onSelectEvent,
}: AuditEventDetailProps) {
  const color = decisionColor(event.final_decision);
  const [sessionRows, setSessionRows] = useState<AgentWatchEvent[]>([]);
  const [showVerify, setShowVerify] = useState(false);
  const [showEngine, setShowEngine] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionEvents({
      installId: event.install_id,
      sessionId: event.session_id,
      limit: 100,
    }).then((res) => {
      if (!cancelled) setSessionRows(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [event.install_id, event.session_id]);

  const brief = useMemo(() => buildEventRiskBrief(event), [event]);
  const context = useMemo(() => traceContextFields(event), [event]);
  const showGrayRhino = isGrayRhinoEvent(event);
  const hasHits = event.l0_triggered_rules.length > 0 || showGrayRhino;

  return (
    <div className={`dash-audit-detail ${compact ? 'dash-audit-detail--compact' : ''}`}>
      <header className="dash-audit-detail__hero">
        <div className="dash-audit-detail__hero-main">
          <span
            className="dash-audit-detail__decision"
            style={{ color, borderColor: `${color}40`, background: `${color}14` }}
          >
            {event.final_decision}
          </span>
          <p className="dash-audit-detail__summary">
            <span className="dash-audit-detail__tool">{event.tool_name}</span>
            <span className="dash-audit-detail__summary--mono">
              {formatTimestamp(event.timestamp_ms)}
            </span>
          </p>
        </div>
        {onClose && (
          <button type="button" className="dash-text-btn" onClick={onClose}>
            关闭
          </button>
        )}
      </header>

      <AuditRiskBrief brief={brief} />

      {hasHits && (
        <section className="dash-audit-section">
          <div className="dash-audit-section__head">
            <h4 className="dash-audit-section__title">判定依据</h4>
            <button
              type="button"
              className="dash-text-btn dash-audit-section__toggle"
              aria-expanded={showEngine}
              onClick={() => setShowEngine((v) => !v)}
            >
              {showEngine ? '收起引擎字段' : '展开引擎字段'}
            </button>
          </div>
          {showEngine && (
            <>
              {event.block_reason?.trim() && (
                <p className="dash-audit-detail__engine-line">
                  <span className="dash-audit-detail__engine-label">引擎记录</span>
                  <code>{event.block_reason.trim()}</code>
                </p>
              )}
              <AuditRiskAccordion event={event} />
            </>
          )}
          {!showEngine && brief.evidenceLines.length === 0 && (
            <p className="dash-audit-detail__note">
              展开后可查看 matchedFields、规则 ID 等完整引擎字段。
            </p>
          )}
        </section>
      )}

      {hasTraceContext(event) && (
        <section className="dash-audit-section">
          <h4 className="dash-audit-section__title">调用上下文</h4>
          <FactGrid rows={context} />
        </section>
      )}

      <SessionTimeline event={event} onSelectEvent={onSelectEvent} />

      <section className="dash-audit-section dash-audit-section--foot">
        <p className="dash-audit-detail__note">
          正常放行（ALLOW）不在此页列出。完整会话链与参数摘要请在本机运行{' '}
          <code className="dash-audit-detail__inline-code">agentwatch audit verify</code>
        </p>
        <button
          type="button"
          className="dash-text-btn dash-audit-verify-toggle"
          aria-expanded={showVerify}
          onClick={() => setShowVerify((v) => !v)}
        >
          {showVerify ? '收起链式验真' : '链式验真（可选）'}
        </button>
        {showVerify && (
          <AuditIntegrityBlock event={event} sessionRows={sessionRows} />
        )}
      </section>
    </div>
  );
}
