import { useMemo, useState, type MouseEvent } from 'react';
import DashCollapsiblePanel from '@/components/dashboard/DashCollapsiblePanel';
import type { AgentWatchEvent, RiskLevel } from '@/types/events';
import { actionDisplay, formatTimestamp, riskScoreDisplay } from '@/types/events';

const BRIEF_OPEN_KEY = 'agentwatch_report_brief_open';

function riskLevelLabel(level: RiskLevel | undefined, score: number, decision: string): string {
  if (level === 'HIGH') return `高风险 · ${String(riskScoreDisplay(score))}`;
  if (level === 'MEDIUM') return `中风险 · ${String(riskScoreDisplay(score))}`;
  if (level === 'LOW') return `低风险 · ${String(riskScoreDisplay(score))}`;
  if (decision === 'BLOCK') return `高风险 · ${String(riskScoreDisplay(score))}`;
  if (decision === 'WARN') return `中风险 · ${String(riskScoreDisplay(score))}`;
  return `风险 ${String(riskScoreDisplay(score))}`;
}

function formatAgentName(agentId: string, label?: string): string {
  if (label?.trim()) return label.trim();
  if (!agentId) return '—';
  return agentId.replace(/^agent_/, '').replace(/_/g, ' ') || agentId;
}

function readBriefOpen(): boolean {
  try {
    return localStorage.getItem(BRIEF_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface ReportBriefProps {
  events: AgentWatchEvent[];
  loading?: boolean;
  agentLabel?: string;
}

function BriefCell({
  label,
  value,
  hint,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string;
  hint: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty('--mx', `${String(x)}%`);
    e.currentTarget.style.setProperty('--my', `${String(y)}%`);
  };

  return (
    <div
      className="dash-report-brief__cell"
      onMouseMove={handleMove}
      onMouseLeave={(e) => {
        e.currentTarget.style.removeProperty('--mx');
        e.currentTarget.style.removeProperty('--my');
      }}
    >
      <span className="dash-report-brief__sheen" aria-hidden />
      <span className="dash-report-brief__label">{label}</span>
      <span
        className={`dash-report-brief__value ${mono ? 'dash-report-brief__value--mono' : ''} ${
          truncate ? 'dash-report-brief__value--truncate' : ''
        }`}
      >
        {value}
      </span>
      <span className="dash-report-brief__hint">{hint}</span>
    </div>
  );
}

export default function ReportBrief({ events, loading, agentLabel }: ReportBriefProps) {
  const [open, setOpen] = useState(readBriefOpen);

  const insight = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    const latestBlock = sorted.find((e) => e.final_decision === 'BLOCK');

    const toolCounts = new Map<string, number>();
    for (const e of events.filter((ev) => ev.final_decision === 'BLOCK')) {
      const key = e.tool_name || 'unknown';
      toolCounts.set(key, (toolCounts.get(key) ?? 0) + 1);
    }
    const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    const peak = events.reduce<AgentWatchEvent | null>(
      (best, e) => (!best || e.l1_combined_score > best.l1_combined_score ? e : best),
      null,
    );

    const blocks = events.filter((e) => e.final_decision === 'BLOCK').length;

    const riskAgent = peak;

    return { latestBlock, topTool, peak, riskAgent, coverage: events.length, blocks };
  }, [events]);

  const collapseSummary = loading
    ? '加载中…'
    : `峰值 ${insight.peak ? String(riskScoreDisplay(insight.peak.l1_combined_score)) : '—'} · ${String(insight.blocks)} BLOCK · ${String(insight.coverage)} 条`;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(BRIEF_OPEN_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <DashCollapsiblePanel
      title="报告摘要"
      subtitle={`深度分析 · 最近 ${String(insight.coverage)} 条审计记录`}
      collapseSummary={collapseSummary}
      open={open}
      onOpenChange={handleOpenChange}
      enterDelay={60}
      ariaLabel="报告摘要"
    >
      {loading ? (
        <div className="dash-skeleton h-16 rounded-lg" />
      ) : (
        <div className="dash-report-brief">
          <BriefCell
            label="最近拦截"
            value={insight.latestBlock ? formatTimestamp(insight.latestBlock.timestamp_ms) : '—'}
            hint={insight.latestBlock ? actionDisplay(insight.latestBlock) : '暂无 BLOCK'}
          />
          <BriefCell
            label="峰值风险"
            value={insight.peak ? String(riskScoreDisplay(insight.peak.l1_combined_score)) : '—'}
            hint={insight.peak ? insight.peak.final_decision : '无数据'}
            mono
          />
          <BriefCell
            label="高频拦截工具"
            value={insight.topTool ? insight.topTool[0] : '—'}
            hint={insight.topTool ? `${String(insight.topTool[1])} 次 BLOCK` : '暂无'}
            truncate
          />
          <BriefCell
            label="Agent"
            value={
              insight.riskAgent
                ? formatAgentName(insight.riskAgent.agent_id, agentLabel)
                : '—'
            }
            hint={
              insight.riskAgent
                ? riskLevelLabel(
                    insight.riskAgent.risk_level,
                    insight.riskAgent.l1_combined_score,
                    insight.riskAgent.final_decision,
                  )
                : '暂无风险记录'
            }
            truncate
          />
        </div>
      )}
    </DashCollapsiblePanel>
  );
}
