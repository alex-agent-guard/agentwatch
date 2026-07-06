import { useState } from 'react';
import {
  buildAuditHitItems,
  copyHitDetailText,
  type AuditHitItem,
  type ObjectiveFactGroup,
  type ObjectiveFactRow,
} from '@/lib/auditRiskItems';
import { buildCorrelatedFactRows, buildL1FactRows } from '@/lib/ruleEvidence';
import { hitEvidenceTeaser, hitLabel } from '@/lib/auditRiskBrief';
import { severityLabel } from '@/lib/eventDetail';
import type { AgentWatchEvent } from '@/types/events';

interface AuditRiskAccordionProps {
  event: AgentWatchEvent;
}

const FACT_GROUP_LABEL: Record<ObjectiveFactGroup, string> = {
  context: '事件字段',
  call: '参数摘要',
  chain: '工具链',
  detection: '检测引擎',
  audit: '审计凭证',
};

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

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIconButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      className={`dash-risk-tier__copy-icon ${copied ? 'dash-risk-tier__copy-icon--done' : ''}`}
      onClick={onCopy}
      aria-label={copied ? '已复制' : '复制记录'}
      title={copied ? '已复制' : '复制记录'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function FactGroup({ title, rows }: { title: string; rows: ObjectiveFactRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="dash-risk-tier__fact-group">
      <p className="dash-risk-tier__fact-group-label">{title}</p>
      <dl className="dash-risk-tier__fact-grid">
        {rows.map((row) => (
          <div key={row.id} className="dash-risk-tier__fact-row">
            <dt>{row.label}</dt>
            <dd className={row.mono ? 'dash-risk-tier__fact-mono' : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HitDetail({ event, hit }: { event: AgentWatchEvent; hit: AuditHitItem }) {
  const [copied, setCopied] = useState(false);
  const correlated =
    hit.engine === 'L0' && hit.ruleId
      ? buildCorrelatedFactRows(event, hit.ruleId)
      : hit.engine === 'L1'
        ? buildL1FactRows(event)
        : [];

  const byGroup = (rows: ObjectiveFactRow[]) => ({
    context: rows.filter((r) => r.group === 'context'),
    call: rows.filter((r) => r.group === 'call'),
    chain: rows.filter((r) => r.group === 'chain'),
    detection: rows.filter((r) => r.group === 'detection'),
    audit: rows.filter((r) => r.group === 'audit'),
  });

  const corr = byGroup(correlated);

  const handleCopy = () => {
    void copyHitDetailText(event, hit).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="dash-risk-tier__detail">
      <div className="dash-risk-tier__detail-toolbar">
        <div className="dash-risk-tier__detail-meta">
          <span className="dash-risk-tier__layer">{hit.engine}</span>
          {hit.ruleId && <code className="dash-risk-tier__rule-id">{hit.ruleId}</code>}
          {hit.severity && (
            <span className="dash-risk-tier__severity">{severityLabel(hit.severity)}</span>
          )}
        </div>
        <CopyIconButton copied={copied} onCopy={handleCopy} />
      </div>

      {hit.engine === 'L0' && hit.ruleId && (
        <section className="dash-risk-tier__panel dash-risk-tier__panel--judgment">
          <h5 className="dash-risk-tier__panel-title">命中证据</h5>
          <dl className="dash-risk-tier__fact-grid">
            <div className="dash-risk-tier__fact-row">
              <dt>规则</dt>
              <dd className="dash-risk-tier__fact-mono">{hit.ruleId}</dd>
            </div>
            {hit.severity && (
              <div className="dash-risk-tier__fact-row">
                <dt>严重级别</dt>
                <dd className="dash-risk-tier__fact-mono">{hit.severity}</dd>
              </div>
            )}
          </dl>
          {hit.matchedFields && Object.keys(hit.matchedFields).length > 0 && (
            <>
              <p className="dash-risk-tier__panel-note dash-risk-tier__panel-note--inline">匹配字段</p>
              <dl className="dash-risk-tier__fact-grid">
                {Object.entries(hit.matchedFields).map(([key, val]) => (
                  <div key={key} className="dash-risk-tier__fact-row">
                    <dt>{key}</dt>
                    <dd className="dash-risk-tier__fact-mono">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      )}

      {correlated.length > 0 && (
        <section className="dash-risk-tier__panel">
          <div className="dash-risk-tier__panel-head">
            <h5 className="dash-risk-tier__panel-title">相关上下文</h5>
          </div>
          <FactGroup title={FACT_GROUP_LABEL.context} rows={corr.context} />
          <FactGroup title={FACT_GROUP_LABEL.chain} rows={corr.chain} />
          <FactGroup title={FACT_GROUP_LABEL.call} rows={corr.call} />
        </section>
      )}
    </div>
  );
}

function accordionHitLabel(hit: AuditHitItem): string {
  return hitLabel(hit);
}

function accordionHitTeaser(event: AgentWatchEvent, hit: AuditHitItem): string {
  return hitEvidenceTeaser(event, hit);
}

export default function AuditRiskAccordion({ event }: AuditRiskAccordionProps) {
  const items = buildAuditHitItems(event);
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <p className="dash-audit-detail__note">本次记录未关联到可展示的引擎命中项。</p>
    );
  }

  return (
    <div className="dash-risk-tier">
      <ul className="dash-risk-tier__list">
        {items.map((hit) => {
          const isOpen = openId === hit.id;
          return (
            <li key={hit.id} className={`dash-risk-tier__item ${isOpen ? 'dash-risk-tier__item--open' : ''}`}>
              <button
                type="button"
                className="dash-risk-tier__head"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : hit.id)}
              >
                <span
                  className={`dash-risk-tier__chev ${isOpen ? 'dash-risk-tier__chev--open' : ''}`}
                  aria-hidden
                >
                  ›
                </span>
                <span className="dash-risk-tier__head-main">
                  <span className="dash-risk-tier__title">{accordionHitLabel(hit)}</span>
                  {!isOpen && (
                    <span className="dash-risk-tier__teaser">{accordionHitTeaser(event, hit)}</span>
                  )}
                </span>
                <span className="dash-risk-tier__meta">
                  {hit.ruleId && (
                    <code className="dash-risk-tier__rule-id dash-risk-tier__rule-id--compact">
                      {hit.ruleId}
                    </code>
                  )}
                </span>
              </button>
              {isOpen && <HitDetail event={event} hit={hit} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
