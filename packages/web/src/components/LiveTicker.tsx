const TICKER_ITEMS = [
  'tools/call transfer · BLOCK · l1_score 0.91',
  'audit verify · log.jsonl · 847 entries · exit 0',
  'agentwatch proxy · stdio MCP · P99 < 50ms',
  'HMAC chain intact · evt-003 · install_id synced',
  'L0 BLOCK_001 · L1 markov anomaly · WARN',
  'npm @agentwatch-web3/cli · init · proxy · status',
];

export default function LiveTicker() {
  const text = TICKER_ITEMS.join('          ◆          ');

  return (
    <div className="live-ticker relative z-20 overflow-hidden border-t border-white/10 bg-black/80 py-2.5 backdrop-blur-sm">
      <div className="live-ticker-track flex whitespace-nowrap font-mono text-[11px] tracking-wide text-white/70">
        <span className="live-ticker-content px-4">{text}</span>
        <span className="live-ticker-content px-4" aria-hidden>
          {text}
        </span>
      </div>
    </div>
  );
}
