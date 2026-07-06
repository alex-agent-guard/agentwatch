import type { DemoScenario } from '@/data/mockData';

export function parseDemoScenario(raw: string | null): DemoScenario {
  if (raw === 'warn' || raw === 'block') return raw;
  return 'healthy';
}

const SCENARIOS: Array<{ id: DemoScenario; label: string }> = [
  { id: 'healthy', label: '一切正常' },
  { id: 'warn', label: '警告' },
  { id: 'block', label: '拦截' },
];

interface ProtectionDemoScenariosProps {
  value: DemoScenario;
  onChange: (next: DemoScenario) => void;
}

/** Demo 首页 — 切换保护态场景 */
export default function ProtectionDemoScenarios({ value, onChange }: ProtectionDemoScenariosProps) {
  return (
    <div className="protect-demo-scenarios" role="tablist" aria-label="体验不同保护状态">
      {SCENARIOS.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`protect-demo-scenarios__chip protect-demo-scenarios__chip--${item.id}${active ? ' protect-demo-scenarios__chip--active' : ''}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
