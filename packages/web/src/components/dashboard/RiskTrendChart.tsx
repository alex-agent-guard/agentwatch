import type { CSSProperties } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface RiskTrendChartProps {
  data: Array<{ time: string; score: number; blocks: number }>;
  enterDelay?: number;
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const labels: Record<string, string> = {
    score: '风险分',
    blocks: '拦截',
  };

  return (
    <div className="dash-chart-tooltip">
      <div className="dash-chart-tooltip__body">
        <span className="dash-chart-tooltip__title">{label}</span>
        {payload.map((entry) => (
          <span key={entry.name} className="dash-chart-tooltip__meta">
            <span
              className="dash-chart-tooltip__dot"
              style={{ background: entry.color, display: 'inline-block', marginRight: '0.35rem' }}
              aria-hidden
            />
            {labels[entry.name ?? ''] ?? entry.name} {entry.value}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RiskTrendChart({ data, enterDelay = 140 }: RiskTrendChartProps) {
  return (
    <div
      className="dash-glass dash-panel p-4 md:p-5 dash-enter"
      style={{ '--dash-delay': `${String(enterDelay)}ms` } as CSSProperties}
    >
      <div className="dash-panel__head">
        <h3 className="dash-panel__title">风险趋势</h3>
        <p className="dash-panel__desc">分数与拦截随时间变化</p>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="time" stroke="#5C6270" fontSize={11} tickLine={false} />
            <YAxis stroke="#5C6270" fontSize={11} tickLine={false} domain={[0, 100]} />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
              wrapperStyle={{ outline: 'none', zIndex: 20, pointerEvents: 'none' }}
            />
            <Line
              type="monotone"
              dataKey="score"
              name="score"
              stroke="#2979FF"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="blocks"
              name="blocks"
              stroke="#FF4D4F"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
