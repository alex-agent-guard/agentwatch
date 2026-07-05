import { useEffect, useRef, useState } from 'react';

interface FilterPillBarProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

export default function FilterPillBar<T extends string>({
  options,
  value,
  onChange,
}: FilterPillBarProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const update = () => {
      const container = containerRef.current;
      if (!container) return;
      const activeBtn = container.querySelector<HTMLButtonElement>(
        `[data-pill-value="${value}"]`,
      );
      if (!activeBtn) return;
      setIndicator({
        left: activeBtn.offsetLeft,
        width: activeBtn.offsetWidth,
      });
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [value, options]);

  return (
    <div ref={containerRef} className="dash-pill-bar">
      <span
        className="dash-pill-bar__indicator"
        style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        aria-hidden
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-pill-value={opt.value}
          onClick={() => onChange(opt.value)}
          className={`dash-pill-bar__btn ${value === opt.value ? 'dash-pill-bar__btn--active' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
