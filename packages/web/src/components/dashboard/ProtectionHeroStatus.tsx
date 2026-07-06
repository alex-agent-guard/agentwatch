import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { getProtectionTone, type ProtectionTone } from '@/lib/protectionStatus';

interface ProtectionHeroStatusProps {
  installId: string;
  auditCount: number;
  warnCount: number;
  blockCount: number;
  hasEvents: boolean;
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const TONE_COPY: Record<
  ProtectionTone,
  { badge: string; title: string; subtitle: string }
> = {
  healthy: {
    badge: '已开启 · 一切正常',
    title: '一切正常',
    subtitle: '汐底在为你的 agent 护航',
  },
  warn: {
    badge: '注意 · 有需要留意的操作',
    title: '发现注意项',
    subtitle: '请查看下方记录，确认 Agent 操作是否预期',
  },
  block: {
    badge: '警示 · 已拦截风险',
    title: '已为你拦截危险操作',
    subtitle: '汐底挡住了可疑行为，你的 Agent 仍受保护',
  },
};

function StatusWatermark({ tone }: { tone: ProtectionTone }) {
  if (tone === 'healthy') {
    return (
      <svg className="protect-shell__shield-watermark" viewBox="0 0 120 140" fill="none">
        <path
          d="M60 8L16 28v38c0 32 18.5 62 44 74 25.5-12 44-42 44-74V28L60 8z"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <path
          d="M42 68l14 14 28-30"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === 'warn') {
    return (
      <svg className="protect-shell__shield-watermark" viewBox="0 0 120 120" fill="none">
        <path
          d="M60 14L108 98H12L60 14z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M60 44v28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="60" cy="84" r="2.5" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className="protect-shell__shield-watermark" viewBox="0 0 120 140" fill="none">
      <path
        d="M60 8L16 28v38c0 32 18.5 62 44 74 25.5-12 44-42 44-74V28L60 8z"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="M44 58l32 32M76 58L44 90"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 保护态状态 — 叠在视频底部渐变上 */
export default function ProtectionHeroStatus({
  installId,
  auditCount,
  warnCount,
  blockCount,
  hasEvents,
}: ProtectionHeroStatusProps) {
  const animatedCount = useAnimatedNumber(auditCount, 680);
  const animatedWarns = useAnimatedNumber(warnCount, 680);
  const animatedBlocks = useAnimatedNumber(blockCount, 680);
  const tone = getProtectionTone(blockCount, warnCount);
  const copy = TONE_COPY[tone];

  return (
    <div
      className={`protect-shell__status protect-shell__status--${tone}`}
      aria-label="安全守护状态"
    >
      <div className="protect-shell__status-aura" aria-hidden>
        <StatusWatermark tone={tone} />
      </div>

      <div className="protect-shell__status-row">
        <div className="protect-shell__status-copy">
          <div className={`protect-shell__live protect-shell__live--${tone}`}>
            <span className="protect-shell__live-dot" />
            {copy.badge}
          </div>

          <h2 className={`protect-shell__title protect-shell__title--hero protect-shell__title--${tone}`}>
            <span className="protect-shell__title-main">{copy.title}</span>
            {tone !== 'healthy' && <span className="protect-shell__title-accent" aria-hidden />}
            <span className="protect-shell__title-sub">{copy.subtitle}</span>
          </h2>

          <p className="protect-shell__agent">{truncateId(installId)}</p>
        </div>

        <div className="protect-shell__stats">
          {!hasEvents ? (
            <div className="protect-shell__stat protect-shell__stat--shield">
              <span className={`protect-shell__shield-ring protect-shell__shield-ring--${tone}`} aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  {tone === 'healthy' ? (
                    <>
                      <path
                        d="M12 2.5L4.5 6v6.2c0 4.8 3.2 9.3 7.5 10.8 4.3-1.5 7.5-6 7.5-10.8V6L12 2.5z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M8.5 12l2.5 2.5 5-5.2"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </>
                  ) : tone === 'warn' ? (
                    <>
                      <path
                        d="M12 3.5L3 19h18L12 3.5z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </>
                  ) : (
                    <>
                      <path
                        d="M12 2.5L4.5 6v6.2c0 4.8 3.2 9.3 7.5 10.8 4.3-1.5 7.5-6 7.5-10.8V6L12 2.5z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9 9.5l6 6M15 9.5l-6 6"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              </span>
              <span className={`protect-shell__stat-label protect-shell__stat-label--shield protect-shell__stat-label--${tone}`}>
                {tone === 'healthy' ? '安全运行中' : tone === 'warn' ? '等待确认' : '风险已挡'}
              </span>
            </div>
          ) : (
            <>
              <div className="protect-shell__stat">
                <span className="protect-shell__stat-value">{animatedCount}</span>
                <span className="protect-shell__stat-label">已记录</span>
              </div>
              {warnCount > 0 && (
                <div className="protect-shell__stat protect-shell__stat--warn">
                  <span className="protect-shell__stat-value">{animatedWarns}</span>
                  <span className="protect-shell__stat-label">需注意</span>
                </div>
              )}
              {blockCount > 0 && (
                <div className="protect-shell__stat protect-shell__stat--danger">
                  <span className="protect-shell__stat-value">{animatedBlocks}</span>
                  <span className="protect-shell__stat-label">已拦截</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
