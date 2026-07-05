import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from 'recharts';

interface DistributionDatum {
  name: string;
  value: number;
  color: string;
}

interface RiskDistributionChartProps {
  data: DistributionDatum[];
  enterDelay?: number;
}

const REFINED: Record<string, string> = {
  ALLOW: '#6b9e86',
  WARN: '#b8955a',
  BLOCK: '#b86b6b',
};

interface SectorProps {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  percent: number;
}

const DECISION_ZH: Record<string, string> = {
  ALLOW: '放行',
  WARN: '警告',
  BLOCK: '拦截',
};

function DistributionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const title = DECISION_ZH[item.name] ?? item.name;

  return (
    <div className="dash-chart-tooltip">
      <span className="dash-chart-tooltip__dot" style={{ background: item.color }} aria-hidden />
      <div className="dash-chart-tooltip__body">
        <span className="dash-chart-tooltip__title">{title}</span>
        <span className="dash-chart-tooltip__meta">
          {item.value} 次 · {item.percent}%
        </span>
      </div>
    </div>
  );
}

/** 0→1 平滑过渡，用于 3D 抬升 */
function useSmoothScalar(target: number, speed = 0.11): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cur = valueRef.current;
      const next = cur + (targetRef.current - cur) * speed;
      valueRef.current = next;
      setValue(next);
      if (Math.abs(next - targetRef.current) > 0.004) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, speed]);

  return value;
}

function LiftedSector(props: SectorProps & { lift: number }) {
  const {
    cx = 0,
    cy = 0,
    innerRadius = 0,
    outerRadius = 0,
    startAngle = 0,
    endAngle = 0,
    fill = '#888',
    lift,
  } = props;

  const midRad = (((startAngle + endAngle) / 2) * Math.PI) / 180;
  const offset = lift * 5;
  const tx = Math.cos(-midRad) * offset * 0.4;
  const ty = Math.sin(-midRad) * offset * 0.4;
  const expanded = Number(outerRadius) + lift * 5;
  const shadowBlur = 4 + lift * 10;
  const shadowAlpha = 0.15 + lift * 0.2;

  return (
    <g
      style={{
        transform: `translate(${String(tx)}px, ${String(ty)}px)`,
        filter: `drop-shadow(0 ${String(2 + lift * 4)}px ${String(shadowBlur)}px rgba(0,0,0,${String(shadowAlpha)}))`,
      }}
    >
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={expanded}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={0.75 + lift * 0.5}
      />
    </g>
  );
}

export default function RiskDistributionChart({
  data,
  enterDelay = 180,
}: RiskDistributionChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const lift = useSmoothScalar(hoverIndex !== null ? 1 : 0, 0.09);

  const enriched = useMemo(() => {
    const total = data.reduce((s, d) => s + d.value, 0);
    return data.map((d) => ({
      ...d,
      color: REFINED[d.name] ?? d.color,
      total,
      percent: total > 0 ? Math.round((d.value / total) * 100) : 0,
    }));
  }, [data]);

  const total = enriched[0]?.total ?? 0;
  const trackData = [{ value: 1 }];

  const setHover = useCallback((index: number | null) => {
    if (leaveTimer.current !== undefined) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = undefined;
    }
    if (index === null) {
      leaveTimer.current = window.setTimeout(() => setHoverIndex(null), 100);
    } else {
      setHoverIndex(index);
    }
  }, []);

  useEffect(
    () => () => {
      if (leaveTimer.current !== undefined) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const renderActive = useCallback(
    (props: SectorProps) => <LiftedSector {...props} lift={lift} />,
    [lift],
  );

  const inactiveOpacity = (index: number): number => {
    if (hoverIndex === null) return 0.88;
    if (hoverIndex === index) return 1;
    return 0.42 + (1 - lift) * 0.2;
  };

  return (
    <div
      className="dash-glass dash-panel dash-panel--chart p-4 md:p-5 dash-enter"
      style={{ '--dash-delay': `${String(enterDelay)}ms` } as CSSProperties}
    >
      <div className="dash-panel__head">
        <h3 className="dash-panel__title">决策分布</h3>
        <p className="dash-panel__desc">ALLOW / WARN / BLOCK</p>
      </div>

      <div className="dash-donut-wrap">
        <div className="dash-donut-ambient" aria-hidden />
        <div className="dash-donut-stage">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={trackData}
                cx="50%"
                cy="50%"
                innerRadius="46%"
                outerRadius="86%"
                dataKey="value"
                stroke="none"
                isAnimationActive={false}
                fill="rgba(255,255,255,0.035)"
              />
              <Pie
                data={enriched}
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="82%"
                paddingAngle={1.5}
                dataKey="value"
                activeIndex={hoverIndex ?? undefined}
                activeShape={renderActive}
                isAnimationActive
                animationBegin={enterDelay}
                animationDuration={1000}
                animationEasing="ease-out"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
                onMouseEnter={(_, index) => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                {enriched.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    opacity={inactiveOpacity(index)}
                    className="dash-donut-sector"
                  />
                ))}
              </Pie>
              <Tooltip
                content={<DistributionTooltip />}
                cursor={false}
                wrapperStyle={{ outline: 'none', zIndex: 20, pointerEvents: 'none' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="dash-donut-center" aria-hidden>
          <div className="dash-donut-center__disc" />
          <span className="dash-donut-center__value">{total}</span>
          <span className="dash-donut-center__label">总计</span>
        </div>
      </div>

      <ul className="dash-donut-legend">
        {enriched.map((d, index) => (
          <li key={d.name}>
            <button
              type="button"
              className={`dash-donut-legend__item ${
                hoverIndex === index ? 'dash-donut-legend__item--active' : ''
              }`}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
            >
              <span className="dash-donut-legend__dot" style={{ background: d.color }} />
              <span className="dash-donut-legend__name">{DECISION_ZH[d.name] ?? d.name}</span>
              <span className="dash-donut-legend__nums">
                {d.value}
                <span className="dash-donut-legend__pct">{d.percent}%</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
