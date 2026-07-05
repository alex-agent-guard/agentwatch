import { useEffect, useRef } from 'react';

export type OrbPalette = 'ember' | 'violet' | 'crimson' | 'meadow';

const PALETTES: Record<
  OrbPalette,
  { core: string; mid: string; outer: string; accent: string }
> = {
  ember: {
    core: 'rgba(255, 220, 120, 0.95)',
    mid: 'rgba(255, 140, 60, 0.45)',
    outer: 'rgba(180, 40, 20, 0.08)',
    accent: '#ff8c42',
  },
  violet: {
    core: 'rgba(200, 160, 255, 0.9)',
    mid: 'rgba(120, 80, 220, 0.4)',
    outer: 'rgba(60, 20, 120, 0.1)',
    accent: '#9b6dff',
  },
  crimson: {
    core: 'rgba(255, 100, 80, 0.5)',
    mid: 'rgba(120, 20, 30, 0.25)',
    outer: 'rgba(40, 0, 0, 0.15)',
    accent: '#8b2020',
  },
  meadow: {
    core: 'rgba(120, 180, 90, 0.35)',
    mid: 'rgba(40, 80, 30, 0.2)',
    outer: 'rgba(10, 30, 10, 0.25)',
    accent: '#3d5c32',
  },
};

interface AtmosphereOrbProps {
  palette: OrbPalette;
  className?: string;
}

/** OKX-style glowing organic blob for feature cards */
export default function AtmosphereOrb({ palette, className = '' }: AtmosphereOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = PALETTES[palette];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let frame = 0;
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      w = parent?.clientWidth ?? 400;
      h = parent?.clientHeight ?? 280;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      frame += 1;
      const t = frame * 0.012;
      ctx.clearRect(0, 0, w, h);

      if (palette === 'meadow') {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#0a1208');
        bg.addColorStop(1, '#050805');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }

      const cx = w * 0.5 + Math.sin(t) * w * 0.06;
      const cy = h * 0.55 + Math.cos(t * 0.8) * h * 0.05;
      const r = Math.min(w, h) * (0.35 + Math.sin(t * 0.5) * 0.05);

      ctx.globalCompositeOperation = 'lighter';

      const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g1.addColorStop(0, colors.core);
      g1.addColorStop(0.35, colors.mid);
      g1.addColorStop(1, colors.outer);
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      if (palette === 'violet') {
        const cx2 = cx + Math.cos(t * 1.2) * 30;
        const cy2 = cy - 20;
        const g2 = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r * 0.5);
        g2.addColorStop(0, 'rgba(255, 180, 255, 0.4)');
        g2.addColorStop(1, 'rgba(80, 40, 160, 0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = 'source-over';

      // Grain
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [palette, colors]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full ${className}`}
      aria-hidden
    />
  );
}
