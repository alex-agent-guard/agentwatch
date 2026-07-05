import { useState } from 'react';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import AtmosphereOrb, { type OrbPalette } from '@/components/AtmosphereOrb';
import LoopVideo from '@/components/LoopVideo';
import TerminalBlock from '@/components/TerminalBlock';

interface FeatureCardProps {
  step: string;
  title: string;
  description: string;
  palette?: OrbPalette;
  videoSrc?: string;
  videoPosition?: string;
  terminal: string[];
  footer?: ReactNode;
}

const cardSpring = { type: 'spring' as const, stiffness: 380, damping: 28 };

export default function FeatureCard({
  step,
  title,
  description,
  palette = 'ember',
  videoSrc,
  videoPosition = 'center',
  terminal,
  footer,
}: FeatureCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.article
      className="feature-card group relative flex min-h-[420px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[rgba(13,14,20,0.55)] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ y: -12, scale: 1.02 }}
      whileTap={{ scale: 0.985, y: -4 }}
      transition={cardSpring}
    >
      {/* hover glow */}
      <motion.div
        className="pointer-events-none absolute -inset-px z-20 rounded-2xl opacity-0"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.35 }}
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.06) 100%)',
          boxShadow: hovered
            ? '0 0 40px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.12)'
            : 'none',
        }}
      />

      {/* shine sweep */}
      <div
        className={`feature-card-shine pointer-events-none absolute inset-0 z-30 ${hovered ? 'is-active' : ''}`}
        aria-hidden
      />

      <motion.div
        className="relative z-10 p-6 pb-0"
        animate={{ x: hovered ? 4 : 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.p
          className="feature-card-step mb-2 text-white/30"
          animate={{ color: hovered ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)' }}
          transition={{ duration: 0.3 }}
        >
          {step}
        </motion.p>
        <h3 className="feature-card-title text-white transition-colors duration-300 group-hover:text-white">
          {title}
        </h3>
        <p className="feature-card-desc mt-2 max-w-[280px] text-white/45 transition-colors duration-300 group-hover:text-white/65">
          {description}
        </p>
      </motion.div>

      <div className="relative mx-4 mt-4 min-h-[200px] flex-1 overflow-hidden rounded-xl border border-white/[0.06] bg-black/40 transition-colors duration-300 group-hover:border-white/[0.14]">
        <motion.div
          className="absolute inset-0"
          animate={{ scale: hovered ? 1.12 : 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {videoSrc ? (
            <>
              <LoopVideo
                src={videoSrc}
                opacity={hovered ? 1 : 0.82}
                objectPosition={videoPosition}
                playbackRate={hovered ? 1.08 : 0.92}
              />
              <div
                className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/30 transition-opacity duration-500 ${hovered ? 'opacity-60' : 'opacity-100'}`}
              />
            </>
          ) : (
            <>
              <AtmosphereOrb palette={palette} />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/20" />
            </>
          )}
        </motion.div>

        {/* scan line on hover */}
        <div
          className={`feature-card-scan pointer-events-none absolute inset-0 z-10 ${hovered ? 'is-active' : ''}`}
          aria-hidden
        />
      </div>

      <motion.div
        className="relative z-10 border-t border-white/[0.06] bg-[rgba(8,9,14,0.72)] p-5 backdrop-blur-md transition-colors duration-300 group-hover:border-white/[0.1] group-hover:bg-[rgba(10,11,18,0.88)]"
        animate={{ y: hovered ? -2 : 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="feature-card-cli-label mb-2 text-white/25 transition-colors duration-300 group-hover:text-white/45">
          agentwatch cli
        </p>
        <TerminalBlock lines={terminal} />
        {footer}
      </motion.div>
    </motion.article>
  );
}
