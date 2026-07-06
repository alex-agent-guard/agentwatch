import type { CSSProperties } from 'react';
import type { ClientServiceLink } from '@/lib/activityStats';
import EntityBrandAvatar from '@/components/dashboard/EntityBrandAvatar';

interface ClientServiceMatrixProps {
  links: ClientServiceLink[];
}

export default function ClientServiceMatrix({ links }: ClientServiceMatrixProps) {
  if (links.length === 0) return null;

  const maxCount = Math.max(...links.map((l) => l.count), 1);

  return (
    <section
      className="protect-panel protect-matrix dash-enter"
      style={{ '--dash-delay': '100ms' } as CSSProperties}
      aria-label="Agent 行为记录"
    >
      <div className="protect-panel__head">
        <h3 className="protect-panel__title">agent 行为记录</h3>
        <span className="protect-panel__meta">{String(links.length)} 组</span>
      </div>

      <ul className="protect-matrix__list">
        {links.map((row, i) => (
          <li
            key={`${row.clientName}:${row.serviceName}`}
            className="protect-matrix__row dash-enter"
            style={{ '--dash-delay': `${String(60 + i * 35)}ms` } as CSSProperties}
          >
            <div className="protect-matrix__side protect-matrix__side--client">
              <EntityBrandAvatar
                kind="client"
                entityKey={row.clientName}
                fallbackShort={row.clientShort}
                fallbackColor={row.clientColor}
                muted={!row.clientReported}
              />
              <span
                className={`protect-matrix__name ${!row.clientReported ? 'protect-matrix__name--pending' : ''}`}
                title={row.clientReported ? row.clientName : undefined}
              >
                {row.clientLabel}
              </span>
            </div>

            <div className="protect-matrix__bridge" aria-hidden>
              <span
                className="protect-matrix__line"
                style={{ opacity: 0.35 + (row.count / maxCount) * 0.65 }}
              />
              <span className="protect-matrix__count">{String(row.count)}</span>
            </div>

            <div className="protect-matrix__side protect-matrix__side--service">
              {row.serviceUrl ? (
                <a
                  href={row.serviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`protect-matrix__name protect-matrix__name--link ${!row.serviceReported ? 'protect-matrix__name--pending' : ''}`}
                  style={{ color: row.serviceColor }}
                  title={row.serviceReported ? row.serviceName : undefined}
                >
                  {row.serviceLabel}
                </a>
              ) : (
                <span
                  className={`protect-matrix__name ${!row.serviceReported ? 'protect-matrix__name--pending' : ''}`}
                  style={{ color: row.serviceColor }}
                  title={row.serviceReported ? row.serviceName : undefined}
                >
                  {row.serviceLabel}
                </span>
              )}
              <EntityBrandAvatar
                kind="service"
                entityKey={row.serviceName}
                fallbackShort={row.serviceLabel.slice(0, 2).toUpperCase()}
                fallbackColor={row.serviceColor}
                muted={!row.serviceReported}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
