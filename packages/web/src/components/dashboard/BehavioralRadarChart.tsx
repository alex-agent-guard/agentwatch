import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

interface BehavioralRadarChartProps {
  data: Array<{ subject: string; A: number; fullMark: number }>;
}

export default function BehavioralRadarChart({ data }: BehavioralRadarChartProps) {
  return (
    <div className="dashboard-panel p-5 md:p-6">
      <h3 className="mb-1 text-base font-medium text-text-primary">行为雷达</h3>
      <p className="mb-4 text-xs text-text-muted">工具调用模式多维分析（演示数据）</p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <Radar
              name="Risk"
              dataKey="A"
              stroke="#2979FF"
              fill="rgba(41,121,255,0.25)"
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
