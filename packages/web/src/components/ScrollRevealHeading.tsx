import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

interface ScrollRevealHeadingProps {
  text: string;
  className?: string;
}

const CUT_EASE = [0.76, 0, 0.24, 1] as const;
const CUT_DURATION = 0.55;

/** 滚动进入视口时，从左侧硬切揭示的大标题 */
export default function ScrollRevealHeading({ text, className = '' }: ScrollRevealHeadingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.35, margin: '0px 0px -60px 0px' });

  return (
    <div ref={ref} className={`relative z-10 inline-block max-w-full ${className}`}>
      <div className="relative overflow-hidden">
        <motion.h2
          className="section-reveal-heading block"
          initial={false}
          animate={
            isInView
              ? { clipPath: 'inset(0 0% 0 0)', x: 0 }
              : { clipPath: 'inset(0 100% 0 0)', x: -32 }
          }
          transition={{ duration: CUT_DURATION, ease: CUT_EASE }}
        >
          {text}
        </motion.h2>

        {/* 切线 — 随揭示从左扫过 */}
        <motion.span
          className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-white/90"
          initial={false}
          animate={
            isInView
              ? { left: ['0%', '100%'], opacity: [1, 1, 0] }
              : { left: '0%', opacity: 0 }
          }
          transition={{
            duration: CUT_DURATION,
            ease: CUT_EASE,
            times: [0, 0.88, 1],
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
