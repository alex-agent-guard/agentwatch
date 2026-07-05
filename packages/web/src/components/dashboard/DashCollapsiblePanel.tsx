import type { CSSProperties, ReactNode } from 'react';

interface DashCollapsiblePanelProps {
  title: string;
  subtitle?: string;
  collapseSummary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  enterDelay?: number;
  ariaLabel?: string;
}

export default function DashCollapsiblePanel({
  title,
  subtitle,
  collapseSummary,
  open,
  onOpenChange,
  toolbar,
  children,
  className = '',
  style,
  enterDelay = 0,
  ariaLabel,
}: DashCollapsiblePanelProps) {
  return (
    <section
      className={`dash-glass dash-panel dash-fold dash-glass--lift-hover ${open ? 'dash-fold--open' : ''} p-4 md:p-5 dash-enter mb-5 ${className}`}
      style={{ '--dash-delay': `${String(enterDelay)}ms`, ...style } as CSSProperties}
      aria-label={ariaLabel ?? title}
    >
      <div className="dash-fold__header">
        <button
          type="button"
          className="dash-fold__toggle"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          <span className={`dash-fold__chev ${open ? 'dash-fold__chev--open' : ''}`}>›</span>
          <span className="dash-fold__title">{title}</span>
          {!open && collapseSummary !== undefined && collapseSummary.length > 0 && (
            <span className="dash-fold__summary">{collapseSummary}</span>
          )}
        </button>
        {open && subtitle !== undefined && subtitle.length > 0 && (
          <p className="dash-panel__desc dash-fold__subtitle">{subtitle}</p>
        )}
      </div>

      {open && toolbar !== undefined && <div className="dash-fold__toolbar">{toolbar}</div>}

      <div className={`dash-fold__body ${open ? 'dash-fold__body--open' : ''}`} aria-hidden={!open}>
        <div className="dash-fold__inner">{children}</div>
      </div>
    </section>
  );
}
