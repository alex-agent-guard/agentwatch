import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import DashCollapsiblePanel from '@/components/dashboard/DashCollapsiblePanel';
import FilterPillBar from '@/components/dashboard/FilterPillBar';
import LayoutScaleSlider, { layoutScaleVars, useLayoutScale } from '@/components/dashboard/LayoutScaleSlider';
import AuditEventDetail from '@/components/dashboard/AuditEventDetail';
import type { AgentWatchEvent, FinalDecision } from '@/types/events';
import {
  actionDisplay,
  riskColor,
  riskScoreDisplay,
} from '@/types/events';

interface ReportAuditTimelineProps {
  events: AgentWatchEvent[];
  loading?: boolean;
  /** URL ?decision=BLOCK|WARN 等 — 初始筛选 */
  initialDecision?: FinalDecision | 'ALL';
}

const FILTER_OPTIONS: Array<{ value: FinalDecision | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'BLOCK', label: 'BLOCK' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ALLOW', label: 'ALLOW' },
];

function formatDateKey(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function groupByDate(items: AgentWatchEvent[]): Array<[string, AgentWatchEvent[]]> {
  const map = new Map<string, AgentWatchEvent[]>();
  for (const e of items) {
    const key = formatDateKey(e.timestamp_ms);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return [...map.entries()];
}

function AuditDetailPane({
  event,
  onClose,
  onSelectEvent,
}: {
  event: AgentWatchEvent;
  onClose: () => void;
  onSelectEvent: (event: AgentWatchEvent) => void;
}) {
  return (
    <div className="dash-audit-pane">
      <AuditEventDetail
        key={event.event_id}
        event={event}
        onClose={onClose}
        onSelectEvent={onSelectEvent}
      />
    </div>
  );
}

const AUDIT_OPEN_KEY = 'agentwatch_report_audit_open';

function readAuditOpen(): boolean {
  try {
    return localStorage.getItem(AUDIT_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

export default function ReportAuditTimeline({
  events,
  loading,
  initialDecision = 'ALL',
}: ReportAuditTimelineProps) {
  const [filter, setFilter] = useState<FinalDecision | 'ALL'>(initialDecision);
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(readAuditOpen);
  const [layoutScale, setLayoutScale] = useLayoutScale();
  const [selectedEvent, setSelectedEvent] = useState<AgentWatchEvent | null>(null);
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFilter(initialDecision);
  }, [initialDecision]);

  const sorted = useMemo(
    () => [...events].sort((a, b) => b.timestamp_ms - a.timestamp_ms),
    [events],
  );

  const filtered = useMemo(() => {
    let rows = filter === 'ALL' ? sorted : sorted.filter((e) => e.final_decision === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (e) =>
          e.event_id.toLowerCase().includes(q) ||
          e.tool_name.toLowerCase().includes(q) ||
          e.hmac.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [sorted, filter, search]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const summary = useMemo(() => {
    const blocks = filtered.filter((e) => e.final_decision === 'BLOCK').length;
    const warns = filtered.filter((e) => e.final_decision === 'WARN').length;
    return { total: filtered.length, blocks, warns };
  }, [filtered]);

  const selected = selectedEvent;

  useEffect(() => {
    if (selectedEvent && !filtered.some((e) => e.event_id === selectedEvent.event_id)) {
      setSelectedEvent(null);
    }
  }, [filtered, selectedEvent]);

  useEffect(() => {
    if (groups.length > 0) {
      setOpenDates(new Set([groups[0][0]]));
    } else {
      setOpenDates(new Set());
    }
  }, [filter, search, groups.length]);

  useEffect(() => {
    if (initialDecision !== 'ALL' && filtered.length > 0 && !selectedEvent) {
      setSelectedEvent(filtered[0] ?? null);
    }
  }, [initialDecision, filtered, selectedEvent]);

  const toggleDate = (date: string) => {
    setOpenDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const shellStyle = layoutScaleVars(layoutScale) as CSSProperties;

  const handlePanelOpen = (next: boolean) => {
    setPanelOpen(next);
    try {
      localStorage.setItem(AUDIT_OPEN_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const toolbar = (
    <>
      <div className="dash-audit-shell__search-row">
        <div className="dash-input-wrap dash-audit-search">
          <svg
            className="dash-input-wrap__icon"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 event / tool / hmac…"
            className="dash-input"
          />
        </div>
        <LayoutScaleSlider value={layoutScale} onChange={setLayoutScale} />
      </div>
      <FilterPillBar options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
    </>
  );

  return (
    <DashCollapsiblePanel
      title="审计事件"
      subtitle="规则命中 · 会话链 · 找病因"
      collapseSummary={`${String(summary.total)} 条 · ${String(summary.blocks)} BLOCK · ${String(summary.warns)} WARN`}
      open={panelOpen}
      onOpenChange={handlePanelOpen}
      toolbar={toolbar}
      className="dash-audit-shell dash-panel--elevated"
      style={shellStyle}
      enterDelay={140}
      ariaLabel="审计时间线"
    >
      {loading && (
        <div className="dash-audit-scroll dash-skeleton-wrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`sk-${String(i)}`} className="dash-skeleton dash-audit-row-sk" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="dash-report-empty">
          {search.trim() ? '无匹配结果' : '该筛选下暂无审计记录'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="dash-audit-split">
          <div className="dash-audit-scroll">
            {groups.map(([date, items]) => {
              const dateOpen = openDates.has(date);
              return (
                <div key={date} className="dash-audit-group">
                  <button
                    type="button"
                    className="dash-audit-group__head"
                    onClick={() => toggleDate(date)}
                    aria-expanded={dateOpen}
                  >
                    <span
                      className={`dash-audit-group__chev ${dateOpen ? 'dash-audit-group__chev--open' : ''}`}
                    >
                      ›
                    </span>
                    <span className="dash-audit-group__date">{date}</span>
                    <span className="dash-audit-group__count">{items.length} 条</span>
                  </button>

                  <div
                    className={`dash-audit-group__body ${dateOpen ? 'dash-audit-group__body--open' : ''}`}
                  >
                    <ul className="dash-audit-rows">
                      {items.map((event) => {
                        const color = riskColor(event.l1_combined_score, event.final_decision);
                        const active = selectedEvent?.event_id === event.event_id;
                        return (
                          <li key={event.event_id}>
                            <button
                              type="button"
                              className={`dash-audit-row dash-audit-row--${event.final_decision.toLowerCase()} ${
                                active ? 'dash-audit-row--active' : ''
                              }`}
                              onClick={() =>
                                setSelectedEvent((prev) =>
                                  prev?.event_id === event.event_id ? null : event,
                                )
                              }
                            >
                              <span
                                className="dash-audit-row__badge"
                                style={{
                                  color,
                                  borderColor: `${color}35`,
                                  background: `${color}12`,
                                }}
                              >
                                {event.final_decision}
                              </span>
                              <span className="dash-audit-row__tool">{actionDisplay(event)}</span>
                              <span className="dash-audit-row__time">{formatTime(event.timestamp_ms)}</span>
                              <span className="dash-audit-row__score" style={{ color }}>
                                {riskScoreDisplay(event.l1_combined_score)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`dash-audit-pane-wrap ${selected ? 'dash-audit-pane-wrap--visible' : ''}`}>
            {selected ? (
              <AuditDetailPane
                event={selected}
                onClose={() => setSelectedEvent(null)}
                onSelectEvent={setSelectedEvent}
              />
            ) : (
              <div className="dash-audit-pane dash-audit-pane--empty">
                <p>选择左侧记录查看详情</p>
              </div>
            )}
          </div>
        </div>
      )}
    </DashCollapsiblePanel>
  );
}
