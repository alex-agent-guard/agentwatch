import { motion, useInView } from 'framer-motion';
import type { ReactNode } from 'react';
import { useRef } from 'react';

interface CutRevealProps {
  children: ReactNode;
  /** left：从左切出；right：从右切出 */
  direction?: 'left' | 'right';
  delay?: number;
  className?: string;
}

const CUT_EASE = [0.76, 0, 0.24, 1] as const;
const CUT_DURATION = 0.55;

/** 滚动进入视口时，从指定方向硬切揭示 */
export default function CutReveal({
  children,
  direction = 'left',
  delay = 0,
  className = '',
}: CutRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.25, margin: '0px 0px -40px 0px' });

  const fromLeft = direction === 'left';
  const hiddenClip = fromLeft ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)';
  const hiddenX = fromLeft ? -32 : 32;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="relative overflow-hidden">
        <motion.div
          initial={false}
          animate={
            isInView
              ? { clipPath: 'inset(0 0% 0 0)', x: 0 }
              : { clipPath: hiddenClip, x: hiddenX }
          }
          transition={{ duration: CUT_DURATION, ease: CUT_EASE, delay }}
        >
          {children}
        </motion.div>

        <motion.span
          className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-white/80"
          initial={false}
          animate={
            isInView
              ? fromLeft
                ? { left: ['0%', '100%'], opacity: [1, 1, 0] }
                : { left: ['100%', '0%'], opacity: [1, 1, 0] }
              : { left: fromLeft ? '0%' : '100%', opacity: 0 }
          }
          transition={{
            duration: CUT_DURATION,
            ease: CUT_EASE,
            delay,
            times: [0, 0.88, 1],
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
