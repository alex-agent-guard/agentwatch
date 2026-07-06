import type { CSSProperties } from 'react';
import { Fragment, useMemo, useState } from 'react';
import FilterPillBar from '@/components/dashboard/FilterPillBar';
import AuditEventDetail from '@/components/dashboard/AuditEventDetail';
import AuditEventExportButton from '@/components/dashboard/AuditEventExportButton';
import type { AgentWatchEvent, FinalDecision } from '@/types/events';
import {
  actionDisplay,
  formatTimestamp,
  riskColor,
  riskScoreDisplay,
} from '@/types/events';

interface AuditEventsTableProps {
  events: AgentWatchEvent[];
  loading?: boolean;
  filter?: FinalDecision | 'ALL';
  onFilterChange?: (filter: FinalDecision | 'ALL') => void;
  emptyHint?: string;
}

const PAGE_SIZE = 8;

const FILTER_OPTIONS: Array<{ value: FinalDecision | 'ALL'; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'BLOCK', label: 'BLOCK' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ALLOW', label: 'ALLOW' },
];

export default function AuditEventsTable({
  events,
  loading,
  filter: controlledFilter,
  onFilterChange,
  emptyHint = '暂无事件 — 运行 proxy 测试后刷新',
}: AuditEventsTableProps) {
  const [search, setSearch] = useState('');
  const [internalFilter, setInternalFilter] = useState<FinalDecision | 'ALL'>('ALL');
  const [page, setPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<AgentWatchEvent | null>(null);

  const filter = controlledFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;

  const filtered = useMemo(() => {
    let rows = events;
    if (filter !== 'ALL') {
      rows = rows.filter((e) => e.final_decision === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.event_id.toLowerCase().includes(q) ||
          e.tool_name.toLowerCase().includes(q) ||
          e.hmac.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [events, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="dash-glass dash-panel dash-panel--elevated p-5 md:p-6 dash-enter" style={{ '--dash-delay': '220ms' } as CSSProperties}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="dash-panel__head mb-0">
          <h3 className="dash-panel__title">审计事件</h3>
          <p className="dash-panel__desc">点击行查看引擎命中与上报字段</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="dash-input-wrap">
            <svg className="dash-input-wrap__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="搜索 event / tool / hmac…"
              className="dash-input"
            />
          </div>
          <FilterPillBar options={FILTER_OPTIONS} value={filter} onChange={(v) => { setFilter(v); setPage(0); }} />
        </div>
      </div>

      <div className="dash-table-wrap dash-table-wrap--audit overflow-x-auto">
        <table className="dash-table dash-table--audit w-full min-w-0 md:min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-xs text-text-muted">
              <th className="px-4 py-3.5 font-medium w-8" />
              <th className="px-4 py-3.5 font-medium">Event</th>
              <th className="px-4 py-3.5 font-medium">Tool</th>
              <th className="px-4 py-3.5 font-medium">Decision</th>
              <th className="px-4 py-3.5 font-medium">Risk</th>
              <th className="px-4 py-3.5 font-medium">Time</th>
              <th className="px-3 py-3.5 font-medium w-10" aria-label="导出" />
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${String(i)}`} className="dash-table-row">
                  <td colSpan={7} className="px-5 py-5">
                    <div className="dash-skeleton h-4" />
                  </td>
                </tr>
              ))}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center text-text-muted">
                  {emptyHint}
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((row) => {
                const score = row.l1_combined_score;
                const color = riskColor(score, row.final_decision);
                const isSelected = selectedEvent?.event_id === row.event_id;
                return (
                  <Fragment key={row.event_id}>
                    <tr
                      onClick={() => setSelectedEvent(isSelected ? null : row)}
                      className={`dash-table-row ${isSelected ? 'dash-table-row--open' : ''}`}
                      data-decision={row.final_decision}
                    >
                      <td className="px-3 py-4 text-center">
                        <span className={`dash-table-row__chev ${isSelected ? 'dash-table-row__chev--open' : ''}`} aria-hidden>
                          ›
                        </span>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-text-data">{row.event_id}</td>
                      <td className="px-4 py-4 text-text-secondary">{actionDisplay(row)}</td>
                      <td className="px-4 py-4">
                        <span
                          className="dash-badge dash-badge--audit"
                          style={{ color, background: `${color}18`, borderColor: `${color}30` }}
                        >
                          {row.final_decision}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-mono text-text-data">
                        {riskScoreDisplay(score)}
                      </td>
                      <td className="px-4 py-4 text-xs text-text-muted">
                        {formatTimestamp(row.timestamp_ms)}
                      </td>
                      <td className="px-3 py-4 text-center">
                        <AuditEventExportButton event={row} />
                      </td>
                    </tr>
                    {isSelected && (
                      <tr className="dash-table-detail-row">
                        <td colSpan={7} className="dash-table-detail-row__cell">
                          <AuditEventDetail
                            key={row.event_id}
                            event={row}
                            onClose={() => setSelectedEvent(null)}
                            onSelectEvent={(next) => {
                              setSelectedEvent(next);
                              const idx = filtered.findIndex((e) => e.event_id === next.event_id);
                              if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
                            }}
                            compact
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-xs text-text-muted">
        <span>
          共 {filtered.length} 条 · 第 {page + 1}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="dash-ghost-btn dash-ghost-btn--nav disabled:opacity-40"
          >
            ← 上一页
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="dash-ghost-btn dash-ghost-btn--nav disabled:opacity-40"
          >
            下一页 →
          </button>
        </div>
      </div>
    </div>
  );
}
