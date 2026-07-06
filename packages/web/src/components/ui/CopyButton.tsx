import { useState, type MouseEvent } from 'react';

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.5 10.5h-1a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3.5 1.5h6A1.5 1.5 0 0 1 11 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface CopyButtonProps {
  text: string;
  title?: string;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export default function CopyButton({
  text,
  title = '复制',
  className = '',
  onClick,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    event.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      className={`dash-copy-btn ${className}`.trim()}
      onClick={handleClick}
      title={title}
      aria-label={title}
    >
      {copied ? <span className="dash-copy-btn__done">✓</span> : <CopyIcon />}
    </button>
  );
}
