import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import FilterPillBar from '@/components/dashboard/FilterPillBar';
import { RiskExplanation } from '@/components/dashboard/RiskExplanation';
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
}: AuditEventsTableProps) {
  const [search, setSearch] = useState('');
  const [internalFilter, setInternalFilter] = useState<FinalDecision | 'ALL'>('ALL');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const selectedRow = filtered.find((e) => e.event_id === selectedId) ?? null;

  return (
    <div className="dash-glass dash-panel dash-panel--elevated p-4 md:p-5 dash-enter" style={{ '--dash-delay': '220ms' } as CSSProperties}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="dash-panel__head mb-0">
          <h3 className="dash-panel__title">审计事件</h3>
          <p className="dash-panel__desc">点击行展开 HMAC 与规则</p>
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

      <div className="dash-table-wrap overflow-x-auto">
        <table className="dash-table w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-xs text-text-muted">
              <th className="px-4 py-3 font-medium w-8" />
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Tool</th>
              <th className="px-4 py-3 font-medium">Decision</th>
              <th className="px-4 py-3 font-medium">Risk</th>
              <th className="px-4 py-3 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${String(i)}`} className="dash-table-row">
                  <td colSpan={6} className="px-4 py-4">
                    <div className="dash-skeleton h-4" />
                  </td>
                </tr>
              ))}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                  暂无事件 — 运行 proxy 测试后刷新
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((row) => {
                const score = row.l1_combined_score;
                const color = riskColor(score, row.final_decision);
                const isSelected = selectedId === row.event_id;
                return (
                  <tr
                    key={row.event_id}
                    onClick={() => setSelectedId(isSelected ? null : row.event_id)}
                    className={`dash-table-row ${isSelected ? 'dash-table-row--open' : ''}`}
                    data-decision={row.final_decision}
                  >
                    <td className="px-2 py-3.5 text-center">
                      <span className={`dash-table-row__chev ${isSelected ? 'dash-table-row__chev--open' : ''}`} aria-hidden>
                        ›
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-text-data">{row.event_id}</td>
                    <td className="px-4 py-3.5 text-text-secondary">{actionDisplay(row)}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className="dash-badge"
                        style={{ color, background: `${color}18`, borderColor: `${color}30` }}
                      >
                        {row.final_decision}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-text-data">
                      {riskScoreDisplay(score)}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-text-muted">
                      {formatTimestamp(row.timestamp_ms)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div
        className={`dash-detail ${selectedRow ? 'dash-detail--open' : ''}`}
        aria-hidden={!selectedRow}
      >
        {selectedRow && (
          <div className="dash-detail__inner">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-text-muted">HMAC 摘要</p>
                <p className="mt-1 break-all font-mono text-[11px] text-text-data">{selectedRow.hmac}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="dash-text-btn"
              >
                关闭
              </button>
            </div>
            <RiskExplanation event={selectedRow} />
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
        <span>
          共 {filtered.length} 条 · 第 {page + 1}/{totalPages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="dash-ghost-btn disabled:opacity-40"
          >
            ← 上一页
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="dash-ghost-btn disabled:opacity-40"
          >
            下一页 →
          </button>
        </div>
      </div>
    </div>
  );
}
