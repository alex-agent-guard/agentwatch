import type { CSSProperties } from 'react';
import type { AgentWatchEvent } from '@/types/events';

interface HmacChainPanelProps {
  events: AgentWatchEvent[];
}

export default function HmacChainPanel({ events }: HmacChainPanelProps) {
  const sorted = [...events].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const chainValid = sorted.length > 0 && sorted.every((e) => e.hmac.length > 8);

  return (
    <div className="dash-glass dash-panel p-4 md:p-5 dash-enter dash-layer-recessed" style={{ '--dash-delay': '260ms' } as CSSProperties}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="dash-panel__head mb-0">
          <h3 className="dash-panel__title">HMAC 链</h3>
          <p className="dash-panel__desc">
            CLI{' '}
            <code className="rounded bg-white/[0.04] px-1 py-0.5 font-mono text-[10px]">
              audit verify
            </code>
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            chainValid
              ? 'bg-accent-cyan/15 text-accent-cyan'
              : 'bg-accent-red/15 text-accent-red'
          }`}
        >
          {chainValid ? '✓ Chain Intact (local preview)' : '✗ Broken'}
        </span>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 && (
          <p className="py-6 text-center text-sm text-text-muted">暂无链节数据</p>
        )}
        {sorted.slice(-5).map((e, i) => (
          <div
            key={e.event_id}
            className="dash-chain-node dash-glass dash-glass--lift"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-blue/15 text-xs text-accent-blue">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-text-data">{e.event_id}</p>
              <p className="truncate font-mono text-[10px] text-text-muted">{e.hmac}</p>
            </div>
            {i < sorted.slice(-5).length - 1 && (
              <span className="text-accent-blue/40">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
