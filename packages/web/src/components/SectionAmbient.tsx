interface SectionAmbientProps {
  /** features：三列卡片区色温；cta：底部号召区 */
  variant?: 'features' | 'cta' | 'default';
}

/** 分区环境光 — 替代纯黑底，提供渐变、光晕与网格层次 */
export default function SectionAmbient({ variant = 'default' }: SectionAmbientProps) {
  return (
    <div className="section-ambient pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c0e16]/90 via-[#090b12] to-[#06070a]" />

      <div className="ambient-orb ambient-orb-a absolute -left-[18%] top-[5%] h-[480px] w-[480px] rounded-full bg-cyan-400/20 blur-[100px]" />
      <div className="ambient-orb ambient-orb-b absolute -right-[12%] top-[25%] h-[520px] w-[520px] rounded-full bg-violet-500/15 blur-[110px]" />
      <div className="ambient-orb ambient-orb-c absolute bottom-[-10%] left-[35%] h-[420px] w-[420px] rounded-full bg-blue-500/12 blur-[90px]" />

      {variant === 'features' && (
        <>
          <div className="absolute left-[6%] top-[18%] hidden h-[55%] w-[26%] rounded-[3rem] bg-cyan-400/[0.045] blur-[70px] lg:block" />
          <div className="absolute left-[37%] top-[22%] hidden h-[50%] w-[26%] rounded-[3rem] bg-amber-400/[0.035] blur-[70px] lg:block" />
          <div className="absolute right-[6%] top-[18%] hidden h-[55%] w-[26%] rounded-[3rem] bg-violet-400/[0.045] blur-[70px] lg:block" />
        </>
      )}

      {variant === 'cta' && (
        <div className="absolute inset-x-0 top-0 h-[280px] bg-gradient-to-b from-blue-500/[0.06] to-transparent" />
      )}

      <div className="dot-grid absolute inset-0 opacity-40" />

      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}
