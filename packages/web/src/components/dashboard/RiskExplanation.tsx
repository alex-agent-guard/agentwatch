import type { AgentWatchEvent } from '@/types/events';
import {
  getRiskCopy,
  getRiskTitle,
  inferCombinationHints,
  shouldShowL1Anomaly,
} from '@/lib/riskCopy';
import { l1ScoreHint, severityLabel } from '@/lib/eventDetail';
import { riskScoreDisplay } from '@/types/events';

interface RiskExplanationProps {
  event: AgentWatchEvent;
  /** full：展示触发条件、建议操作、严重度 */
  variant?: 'compact' | 'full';
}

function LayerBadge({ layer }: { layer: string }) {
  return <span className="dash-risk-explain__layer">{layer}</span>;
}

function RiskItem({
  title,
  trigger,
  risk,
  action,
  severity,
  layer,
}: {
  title: string;
  trigger?: string;
  risk: string;
  action?: string;
  severity?: string;
  layer?: string;
}) {
  return (
    <div className="dash-risk-explain__item">
      <div className="dash-risk-explain__head">
        <p className="dash-risk-explain__title">{title}</p>
        <div className="dash-risk-explain__meta">
          {layer && <LayerBadge layer={layer} />}
          {severity && <span className="dash-risk-explain__severity">{severityLabel(severity)}</span>}
        </div>
      </div>
      {trigger && (
        <p className="dash-risk-explain__trigger">
          <span className="dash-risk-explain__field">触发条件</span>
          {trigger}
        </p>
      )}
      <p className="dash-risk-explain__body">
        <span className="dash-risk-explain__field">风险说明</span>
        {risk}
      </p>
      {action && (
        <p className="dash-risk-explain__action">
          <span className="dash-risk-explain__field">建议操作</span>
          {action}
        </p>
      )}
    </div>
  );
}

export function RiskExplanation({ event, variant = 'compact' }: RiskExplanationProps) {
  const ruleRows = event.l0_triggered_rules;
  const ruleIds = ruleRows.map((r) => r.ruleId);
  const combos = inferCombinationHints(ruleIds);
  const showL1 = shouldShowL1Anomaly(ruleIds, event.l1_combined_score, event.final_decision);
  const full = variant === 'full';
  const scoreHint = full ? l1ScoreHint(event.l1_combined_score, event.final_decision) : null;

  if (ruleIds.length === 0 && combos.length === 0 && !showL1) {
    if (full && event.final_decision !== 'ALLOW') {
      return (
        <div className="dash-audit-detail__row dash-audit-detail__row--stack">
          <p className="dash-audit-detail__note">
            未命中 L0 确定性规则；风险分 {riskScoreDisplay(event.l1_combined_score)}。
            {scoreHint ? ` ${scoreHint}` : ' 请结合工具与时间线人工判断。'}
          </p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="dash-audit-detail__row dash-audit-detail__row--stack">
      {!full && <span className="dash-audit-detail__label">风险</span>}
      <div className="dash-risk-explain">
      {ruleRows.map((row) => {
        const copy = getRiskCopy(row.ruleId);
        const title = getRiskTitle(row.ruleId);
        if (full && copy) {
          return (
            <RiskItem
              key={row.ruleId}
              title={title}
              trigger={copy.triggerPlainZh}
              risk={copy.riskPlainZh}
              action={copy.userAction}
              severity={row.severity}
              layer={copy.layer}
            />
          );
        }
        return (
          <div key={row.ruleId} className="dash-risk-explain__item">
            <p className="dash-risk-explain__title">{title}</p>
            {copy && <p className="dash-risk-explain__body">{copy.riskPlainZh}</p>}
          </div>
        );
      })}
      {combos.map((combo) => (
        <div key={combo.id} className="dash-risk-explain__item dash-risk-explain__item--combo">
          {full ? (
            <RiskItem
              title={combo.copy.userTitleZh}
              trigger={combo.copy.triggerPlainZh}
              risk={combo.copy.riskPlainZh}
              action={combo.copy.userAction}
              layer={combo.copy.layer}
            />
          ) : (
            <>
              <p className="dash-risk-explain__title">{combo.copy.userTitleZh}</p>
              <p className="dash-risk-explain__body">{combo.copy.riskPlainZh}</p>
            </>
          )}
        </div>
      ))}
      {showL1 && (
        <div className="dash-risk-explain__item dash-risk-explain__item--l1">
          {full ? (
            <RiskItem
              title={getRiskCopy('l1_stat_anomaly')!.userTitleZh}
              trigger={getRiskCopy('l1_stat_anomaly')!.triggerPlainZh}
              risk={getRiskCopy('l1_stat_anomaly')!.riskPlainZh}
              action={getRiskCopy('l1_stat_anomaly')!.userAction}
              layer="L1"
            />
          ) : (
            <>
              <p className="dash-risk-explain__title">{getRiskCopy('l1_stat_anomaly')!.userTitleZh}</p>
              <p className="dash-risk-explain__body">{getRiskCopy('l1_stat_anomaly')!.riskPlainZh}</p>
            </>
          )}
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
