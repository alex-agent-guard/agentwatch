interface TerminalBlockProps {
  lines: string[];
  className?: string;
}

export default function TerminalBlock({ lines, className = '' }: TerminalBlockProps) {
  return (
    <div
      className={`font-mono text-[10px] leading-[1.7] text-white/55 md:text-[11px] ${className}`}
    >
      {lines.map((line) => (
        <div key={line} className="whitespace-pre">
          {line}
        </div>
      ))}
    </div>
  );
}
