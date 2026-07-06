import type { CSSProperties } from 'react';
import EntityBrandAvatar from '@/components/dashboard/EntityBrandAvatar';
import type { ActivityRow } from '@/lib/activityStats';
import { formatRelativeTime } from '@/lib/activityStats';
import { clientBrandIcon, serviceBrandIcon } from '@/lib/brandIcons';
import BrandIcon from '@/components/icons/BrandIcon';

const DECISION_CLASS: Record<ActivityRow['decision'], string> = {
  ALLOW: 'protect-decision--allow',
  WARN: 'protect-decision--warn',
  BLOCK: 'protect-decision--block',
};

const DECISION_LABEL: Record<ActivityRow['decision'], string> = {
  ALLOW: '放行',
  WARN: '注意',
  BLOCK: '已拦截',
};

interface RecentActivityProps {
  items: ActivityRow[];
  listening: boolean;
}

export default function RecentActivity({ items, listening }: RecentActivityProps) {
  return (
    <section className="protect-panel protect-activity dash-enter" aria-label="最近活动">
      <div className="protect-panel__head">
        <h3 className="protect-panel__title">最近动态</h3>
        {items.length > 0 && (
          <span className="protect-panel__meta">{String(items.length)} 条</span>
        )}
      </div>

      {listening ? (
        <div className="protect-activity__listening">
          <div className="protect-activity__wave" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="protect-activity__listening-text">还没有活动记录</p>
          <p className="protect-activity__listening-sub">展开下方复制启动命令，在本机运行后这里会显示 Agent 的操作</p>
        </div>
      ) : (
        <ul className="protect-activity__list protect-activity__list--compact">
          {items.map((row, i) => (
            <li
              key={row.eventId}
              className="protect-activity__row dash-enter"
              style={{ '--dash-delay': `${String(60 + i * 30)}ms` } as CSSProperties}
            >
              <div className="protect-activity__leading">
                {clientBrandIcon(row.clientName) ? (
                  <EntityBrandAvatar
                    kind="client"
                    entityKey={row.clientName}
                    fallbackShort={row.clientShort}
                    fallbackColor={row.clientColor}
                    size="sm"
                  />
                ) : (
                  <span
                    className="protect-activity__client-dot"
                    style={{ background: row.clientColor }}
                    title={row.clientReported ? row.clientName : row.clientLabel}
                    aria-hidden
                  />
                )}
                <span className="protect-activity__tool-name">{row.toolName}</span>
              </div>
              <div className="protect-activity__tail">
                <span
                  className="protect-activity__service-tag"
                  style={{ color: row.serviceColor, borderColor: `${row.serviceColor}33` }}
                >
                  {serviceBrandIcon(row.serviceName) && (
                    <BrandIcon id={serviceBrandIcon(row.serviceName)!} size={14} className="protect-activity__service-icon" />
                  )}
                  {row.serviceLabel}
                </span>
                <span className={`protect-decision ${DECISION_CLASS[row.decision]}`}>
                  {DECISION_LABEL[row.decision] ?? row.decision}
                </span>
                <time className="protect-activity__time" dateTime={new Date(row.timestampMs).toISOString()}>
                  {formatRelativeTime(row.timestampMs)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
