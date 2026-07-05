import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

const STORAGE_KEY = 'agentwatch_report_layout_scale';
const DEFAULT = 48;

function readStoredScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return DEFAULT;
  }
}

interface LayoutScaleSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function layoutScaleVars(value: number): CSSProperties {
  const listHeight = 9 + (value / 100) * 15;
  const listShare = 38 + (value / 100) * 34;
  return {
    '--audit-scale': String(value),
    '--audit-list-h': `${String(listHeight)}rem`,
    '--audit-split-list': `${String(listShare)}%`,
  } as CSSProperties;
}

export default function LayoutScaleSlider({ value, onChange }: LayoutScaleSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const next = Math.min(100, Math.max(0, Math.round(ratio * 100)));
      onChange(next);
    },
    [onChange],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="dash-scale" aria-label="列表区域比例">
      <span className="dash-scale__edge">紧凑</span>
      <div
        ref={trackRef}
        className="dash-scale__track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.max(0, value - 4));
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(Math.min(100, value + 4));
          }
        }}
      >
        <div className="dash-scale__rail" />
        <div className="dash-scale__fill" style={{ width: `${String(value)}%` }} />
        <div className="dash-scale__thumb" style={{ left: `${String(value)}%` }}>
          <span className="dash-scale__thumb-core" />
        </div>
      </div>
      <span className="dash-scale__edge">宽松</span>
    </div>
  );
}

export function useLayoutScale(): [number, (v: number) => void] {
  const [scale, setScale] = useState(readStoredScale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      /* ignore */
    }
  }, [scale]);

  return [scale, setScale];
}
