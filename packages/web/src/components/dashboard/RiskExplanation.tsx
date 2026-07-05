import type { AgentWatchEvent } from '@/types/events';
import {
  getRiskCopy,
  getRiskTitle,
  inferCombinationHints,
  shouldShowL1Anomaly,
} from '@/lib/riskCopy';

export function RiskExplanation({ event }: { event: AgentWatchEvent }) {
  const ruleIds = event.l0_triggered_rules.map((r) => r.ruleId);
  const combos = inferCombinationHints(ruleIds);
  const showL1 = shouldShowL1Anomaly(ruleIds, event.l1_combined_score, event.final_decision);

  if (ruleIds.length === 0 && combos.length === 0 && !showL1) {
    return null;
  }

  return (
    <div className="dash-audit-detail__row dash-audit-detail__row--stack">
      <span className="dash-audit-detail__label">风险</span>
      <div className="dash-risk-explain">
      {ruleIds.map((ruleId) => {
        const copy = getRiskCopy(ruleId);
        return (
          <div key={ruleId} className="dash-risk-explain__item">
            <p className="dash-risk-explain__title">{getRiskTitle(ruleId)}</p>
            {copy && <p className="dash-risk-explain__body">{copy.riskPlainZh}</p>}
          </div>
        );
      })}
      {combos.map((combo) => (
        <div key={combo.userTitleZh} className="dash-risk-explain__item dash-risk-explain__item--combo">
          <p className="dash-risk-explain__title">{combo.userTitleZh}</p>
          <p className="dash-risk-explain__body">{combo.riskPlainZh}</p>
        </div>
      ))}
      {showL1 && (
        <div className="dash-risk-explain__item dash-risk-explain__item--l1">
          <p className="dash-risk-explain__title">{getRiskCopy('l1_stat_anomaly')!.userTitleZh}</p>
          <p className="dash-risk-explain__body">{getRiskCopy('l1_stat_anomaly')!.riskPlainZh}</p>
        </div>
      )}
      </div>
    </div>
  );
}

export function RiskRuleTags({ event }: { event: AgentWatchEvent }) {
  const ruleIds = event.l0_triggered_rules.map((r) => r.ruleId);

  if (ruleIds.length === 0) {
    if (shouldShowL1Anomaly(ruleIds, event.l1_combined_score, event.final_decision)) {
      return <span className="dash-tag dash-tag--l1">{getRiskTitle('l1_stat_anomaly')}</span>;
    }
    return null;
  }

  return (
    <>
      {ruleIds.map((ruleId) => {
        const copy = getRiskCopy(ruleId);
        return (
          <span key={ruleId} className="dash-tag" title={copy?.riskPlainZh}>
            {getRiskTitle(ruleId)}
          </span>
        );
      })}
    </>
  );
}
