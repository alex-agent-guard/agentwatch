import type { CSSProperties } from 'react';

interface DashPageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  variant?: 'default' | 'page';
  delay?: number;
}

export default function DashPageHeader({
  title,
  subtitle,
  eyebrow,
  variant = 'default',
  delay = 0,
}: DashPageHeaderProps) {
  return (
    <header
      className={`dash-header ${variant === 'page' ? 'dash-header--page' : ''} dash-enter`}
      style={{ '--dash-delay': `${String(delay)}ms` } as CSSProperties}
    >
      {eyebrow !== undefined && eyebrow.length > 0 && (
        <span className="dash-header__eyebrow">{eyebrow}</span>
      )}
      <h1 className="dash-header__title">{title}</h1>
      {subtitle !== undefined && subtitle.length > 0 && (
        <p className="dash-header__sub">{subtitle}</p>
      )}
    </header>
  );
}
