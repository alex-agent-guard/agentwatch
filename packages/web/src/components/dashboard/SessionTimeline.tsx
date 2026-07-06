import { useEffect, useMemo, useState } from 'react';
import { fetchSessionEvents } from '@/lib/events';
import {
  CHAIN_GAP_COLOR,
  detectTimelineGaps,
  gapLabel,
  sliceTimelineContext,
} from '@/lib/auditDetail';
import type { AgentWatchEvent } from '@/types/events';
import { decisionColor, formatTimestamp } from '@/types/events';

interface SessionTimelineProps {
  event: AgentWatchEvent;
  onSelectEvent?: (event: AgentWatchEvent) => void;
}

const CONTEXT_RADIUS = 5;
const MAX_VISIBLE = 20;

export default function SessionTimeline({ event, onSelectEvent }: SessionTimelineProps) {
  const [rows, setRows] = useState<AgentWatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchSessionEvents({
      installId: event.install_id,
      sessionId: event.session_id,
      limit: 100,
    }).then((res) => {
      if (cancelled) return;
      setRows(res.data);
      setError(res.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [event.install_id, event.session_id]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.timestamp_ms - b.timestamp_ms),
    [rows],
  );

  const { visible, truncatedBefore, truncatedAfter } = useMemo(() => {
    if (expanded) {
      return {
        visible: sorted.slice(0, 100),
        truncatedBefore: 0,
        truncatedAfter: Math.max(0, sorted.length - 100),
      };
    }
    return sliceTimelineContext(sorted, event.event_id, CONTEXT_RADIUS, MAX_VISIBLE);
  }, [sorted, event.event_id, expanded]);

  const gaps = useMemo(() => detectTimelineGaps(visible), [visible]);
  const gapAfterIndex = useMemo(() => new Set(gaps.map((g) => g.afterIndex)), [gaps]);

  return (
    <section className="dash-audit-section">
      <div className="dash-audit-section__head">
        <h4 className="dash-audit-section__title">会话时间线</h4>
        <span className="dash-audit-section__meta font-mono text-xs">{event.session_id}</span>
      </div>
      <p className="dash-session-timeline__note">
        同一会话内其他 WARN/BLOCK；正常放行见本机 audit 日志。
      </p>

      {loading && <p className="dash-audit-detail__note">加载 session 事件…</p>}
      {error && <p className="dash-audit-detail__note dash-audit-detail__note--warn">{error}</p>}

      {!loading && !error && sorted.length === 0 && (
        <p className="dash-audit-detail__note">该会话暂无其他 WARN/BLOCK 记录。</p>
      )}

      {!loading && sorted.length > 0 && (
        <>
          {(truncatedBefore > 0 || truncatedAfter > 0) && !expanded && (
            <p className="dash-audit-detail__note dash-audit-detail__note--muted">
              显示当前事件前后各 {CONTEXT_RADIUS} 条
              {truncatedBefore > 0 ? ` · 前省略 ${truncatedBefore} 条` : ''}
              {truncatedAfter > 0 ? ` · 后省略 ${truncatedAfter} 条` : ''}
            </p>
          )}

          <ol className="dash-session-timeline">
            {visible.map((row, index) => {
              const isCurrent = row.event_id === event.event_id;
              const color = decisionColor(row.final_decision);
              const ruleCount = row.l0_triggered_rules.length;
              const gap = gaps.find((g) => g.afterIndex === index);

              return (
                <li key={row.event_id}>
                  <div
                    className={`dash-session-timeline__item ${isCurrent ? 'dash-session-timeline__item--current' : ''}`}
                  >
                    <button
                      type="button"
                      className="dash-session-timeline__btn"
                      disabled={isCurrent || !onSelectEvent}
                      onClick={() => onSelectEvent?.(row)}
                    >
                      <span className="dash-session-timeline__index">{index + 1}</span>
                      <span className="dash-session-timeline__main">
                        <span className="dash-session-timeline__tool">{row.tool_name}</span>
                        <span className="dash-session-timeline__meta">
                          depth={row.chain_depth}
                          {row.previous_tool ? ` · prev=${row.previous_tool}` : ''}
                          {row.sequence_no !== undefined && row.sequence_no !== null
                            ? ` · seq=${row.sequence_no}`
                            : ''}
                        </span>
                      </span>
                      <span
                        className="dash-session-timeline__decision"
                        style={{ color, borderColor: `${color}40`, background: `${color}14` }}
                      >
                        {row.final_decision}
                      </span>
                      <span className="dash-session-timeline__time">
                        {formatTimestamp(row.timestamp_ms)}
                      </span>
                      {ruleCount > 0 && (
                        <span className="dash-session-timeline__hits">L0×{ruleCount}</span>
                      )}
                    </button>
                  </div>

                  {gapAfterIndex.has(index) && gap && (
                    <div className="dash-session-timeline__gap" style={{ borderColor: CHAIN_GAP_COLOR }}>
                      <span className="dash-session-timeline__gap-icon" style={{ color: CHAIN_GAP_COLOR }}>
                        ⚠
                      </span>
                      <span>{gapLabel(gap.reason)}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {(truncatedBefore > 0 || truncatedAfter > 0 || sorted.length > MAX_VISIBLE) && !expanded && (
            <button type="button" className="dash-text-btn" onClick={() => setExpanded(true)}>
              展开更多（最多 100 条）
            </button>
          )}
        </>
      )}
    </section>
  );
}
