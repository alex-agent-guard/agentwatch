import { useEffect, useRef } from 'react';

/** OKX-style thermal / film-grain animated hero background */
export default function ThermalHeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let frame = 0;
    let raf = 0;

    const blobs = [
      { x: 0.35, y: 0.45, r: 0.28, sx: 0.00008, sy: 0.00006, phase: 0 },
      { x: 0.55, y: 0.35, r: 0.22, sx: -0.00006, sy: 0.00009, phase: 1.2 },
      { x: 0.48, y: 0.62, r: 0.18, sx: 0.00005, sy: -0.00007, phase: 2.4 },
      { x: 0.72, y: 0.55, r: 0.15, sx: -0.00004, sy: 0.00005, phase: 3.1 },
    ];

    const resize = () => {
      const parent = canvas.parentElement;
      w = parent?.clientWidth ?? window.innerWidth;
      h = parent?.clientHeight ?? window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      frame += 1;
      const t = frame * 0.008;

      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';

      for (const blob of blobs) {
        const cx = w * (blob.x + Math.sin(t * 40 * blob.sx * 1000 + blob.phase) * 0.06);
        const cy = h * (blob.y + Math.cos(t * 35 * blob.sy * 1000 + blob.phase) * 0.05);
        const radius = Math.min(w, h) * blob.r * (1 + Math.sin(t + blob.phase) * 0.08);

        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        g.addColorStop(0.15, 'rgba(220, 220, 220, 0.55)');
        g.addColorStop(0.45, 'rgba(80, 80, 80, 0.2)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = 'source-over';

      // Horizontal smear — film motion feel
      ctx.globalAlpha = 0.06;
      ctx.drawImage(canvas, -2, 0, w, h);
      ctx.globalAlpha = 1;

      // Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      // Vignette on canvas
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // Animated grain
      const grainDensity = Math.floor((w * h) / 120);
      for (let i = 0; i < grainDensity; i++) {
        const gx = Math.random() * w;
        const gy = Math.random() * h;
        const v = Math.random() * 255;
        ctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${0.04 + Math.random() * 0.06})`;
        ctx.fillRect(gx, gy, 1, 1);
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full object-cover"
      aria-hidden
    />
  );
}
