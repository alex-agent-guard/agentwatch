import type { EventRiskBrief } from '@/lib/auditRiskBrief';

interface AuditRiskBriefProps {
  brief: EventRiskBrief;
}

export default function AuditRiskBrief({ brief }: AuditRiskBriefProps) {
  if (!brief.headline && brief.tags.length === 0 && brief.evidenceLines.length === 0) {
    return null;
  }

  return (
    <section className="dash-audit-section dash-audit-risk-brief">
      {brief.tags.length > 0 && (
        <ul className="dash-risk-brief__tags" aria-label="风险类型">
          {brief.tags.map((tag) => (
            <li key={tag} className="dash-risk-brief__tag">
              {tag}
            </li>
          ))}
        </ul>
      )}

      <p className="dash-risk-brief__headline">{brief.headline}</p>

      {brief.evidenceLines.length > 0 && (
        <div className="dash-risk-brief__evidence">
          <p className="dash-risk-brief__evidence-label">本条记录</p>
          <ul className="dash-risk-brief__evidence-list">
            {brief.evidenceLines.map((line) => (
              <li key={line} className="dash-risk-brief__evidence-item">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
