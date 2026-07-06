import { useState, type MouseEvent } from 'react';
import type { AgentWatchEvent } from '@/types/events';
import { downloadEvidenceJson } from '@/lib/auditDetail';

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2.5v7M5.5 7 8 9.5 10.5 7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 11.5v1.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface AuditEventExportButtonProps {
  event: AgentWatchEvent;
  className?: string;
}

export default function AuditEventExportButton({ event, className = '' }: AuditEventExportButtonProps) {
  const [exported, setExported] = useState(false);

  const handleClick = (eventClick: MouseEvent<HTMLButtonElement>) => {
    eventClick.stopPropagation();
    downloadEvidenceJson(event);
    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  };

  return (
    <button
      type="button"
      className={`dash-audit-export-btn ${className}`.trim()}
      onClick={handleClick}
      title="导出事件 JSON"
      aria-label="导出事件 JSON"
    >
      {exported ? <span className="dash-copy-btn__done">✓</span> : <ExportIcon />}
    </button>
  );
}
