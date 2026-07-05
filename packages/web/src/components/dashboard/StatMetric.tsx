import type { CSSProperties, MouseEvent } from 'react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';

type MetricTone = 'neutral' | 'safe' | 'warn' | 'danger';

interface StatMetricProps {
  label: string;
  value: string;
  numericValue?: number;
  hint?: string;
  tone?: MetricTone;
  active?: boolean;
  interactive?: boolean;
  className?: string;
  enterIndex?: number;
  onClick?: () => void;
}

const toneClass: Record<MetricTone, string> = {
  neutral: 'dash-metric--neutral',
  safe: 'dash-metric--safe',
  warn: 'dash-metric--warn',
  danger: 'dash-metric--danger',
};

export default function StatMetric({
  label,
  value,
  numericValue,
  hint,
  tone = 'neutral',
  active = false,
  interactive = false,
  className = '',
  enterIndex = 0,
  onClick,
}: StatMetricProps) {
  const Tag = interactive ? 'button' : 'div';
  const num =
    numericValue ??
    (Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : null);
  const animated = useAnimatedNumber(num ?? 0);
  const displayValue = num !== null ? String(animated) : value;

  const handleMove = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--mx', `${String(x)}%`);
    el.style.setProperty('--my', `${String(y)}%`);
  };

  const handleLeave = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.style.removeProperty('--mx');
    e.currentTarget.style.removeProperty('--my');
  };

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      onMouseMove={interactive ? handleMove : undefined}
      onMouseLeave={interactive ? handleLeave : undefined}
      className={`dash-glass dash-metric ${toneClass[tone]} ${
        interactive ? 'dash-metric--interactive dash-glass--lift' : ''
      } ${active ? 'dash-metric--active' : ''} dash-enter ${className}`}
      style={{ '--dash-delay': `${String(enterIndex * 55)}ms` } as CSSProperties}
    >
      <span className="dash-metric__accent" aria-hidden />
      <span className="dash-metric__spotlight" aria-hidden />
      <span className="dash-metric__sheen" aria-hidden />
      <span className="dash-metric__label">{label}</span>
      <span key={displayValue} className="dash-metric__value">
        {displayValue}
      </span>
      {hint !== undefined && hint.length > 0 && (
        <span className="dash-metric__hint">{hint}</span>
      )}
      {interactive && (
        <span className="dash-metric__action" aria-hidden>
          {active ? '已筛选' : '筛选'}
        </span>
      )}
    </Tag>
  );
}
