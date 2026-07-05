import { Area, AreaChart, ResponsiveContainer } from 'recharts';

interface StatCardProps {
  label: string;
  value: string;
  change: string;
  positive?: boolean;
  sparkline: number[];
  active?: boolean;
  interactive?: boolean;
  delayMs?: number;
  onClick?: () => void;
}

export default function StatCard({
  label,
  value,
  change,
  positive = true,
  sparkline,
  active = false,
  interactive = false,
  delayMs = 0,
  onClick,
}: StatCardProps) {
  const data = sparkline.map((v, i) => ({ i, v }));
  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`dashboard-panel dashboard-stat-card p-5 text-left ${
        interactive ? 'dashboard-stat-card--interactive' : ''
      } ${active ? 'dashboard-stat-card--active' : ''}`}
      style={{ animationDelay: `${String(delayMs)}ms` }}
    >
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-text-data">{value}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className={`text-xs ${positive ? 'text-accent-cyan' : 'text-accent-red'}`}>
          {change}
        </span>
        <div className="h-10 w-24 shrink-0 opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <Area
                type="monotone"
                dataKey="v"
                stroke={positive ? '#2eecc9' : '#ff5c5e'}
                fill={positive ? 'rgba(46,236,201,0.12)' : 'rgba(255,92,94,0.12)'}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      {interactive && (
        <p className="mt-3 text-[10px] text-text-muted">点击筛选下方事件</p>
      )}
    </Tag>
  );
}
