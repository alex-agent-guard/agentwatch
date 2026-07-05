import { motion } from 'framer-motion';

const FADE_EASE = [0.22, 1, 0.36, 1] as const;
const SLIDE_EASE = [0.22, 1, 0.36, 1] as const;

const fade = (delay: number) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { delay, duration: 1, ease: FADE_EASE },
});

/** Hero 散落的英文装饰 + 主标题区 */
export default function HeroCopy() {
  return (
    <>
      {/* 英文散落 — 版面呼吸感 */}
      <motion.p
        {...fade(0.5)}
        className="hero-float-en pointer-events-none absolute left-6 top-[22%] z-10 hidden md:block lg:left-12"
      >
        Runtime Security
      </motion.p>

      <motion.p
        {...fade(0.65)}
        className="hero-float-en pointer-events-none absolute right-6 top-[16%] z-10 text-right hidden md:block lg:right-14"
      >
        Security Gateway
      </motion.p>

      <motion.p
        {...fade(0.8)}
        className="hero-float-en pointer-events-none absolute left-6 top-1/2 z-10 hidden origin-left -translate-y-1/2 -rotate-90 lg:left-10 lg:block"
      >
        The Last Gate
      </motion.p>

      <motion.p
        {...fade(0.55)}
        className="hero-float-en pointer-events-none absolute bottom-[22%] left-6 z-10 hidden sm:block lg:left-12"
      >
        Discover · Intercept · Audit
      </motion.p>

      <motion.p
        {...fade(0.7)}
        className="hero-float-en pointer-events-none absolute bottom-[18%] right-6 z-10 hidden max-w-[220px] text-right sm:block lg:right-14"
      >
        Before every tool call executes
      </motion.p>

      {/* 主文案 — 偏右下，留出让出画面 */}
      <div className="relative z-10 flex min-h-screen flex-col justify-end px-6 pb-28 pt-24 lg:justify-center lg:items-end lg:px-16 lg:pb-24">
        <div className="w-full max-w-[560px] lg:ml-auto">
          <motion.p
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.8, ease: SLIDE_EASE }}
            className="hero-float-en mb-8 md:hidden"
          >
            Runtime Security · Security Gateway
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.9, ease: SLIDE_EASE }}
            className="hero-headline"
          >
            <span className="hero-headline-brand">AgentWatch</span>
            <span className="hero-headline-tagline">为你的 Agent 保驾护航</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.7, ease: SLIDE_EASE }}
            className="hero-headline-sub mt-8 max-w-md"
          >
            AI 执行前的最后一道安全闸门。
          </motion.p>
        </div>
      </div>
    </>
  );
}
