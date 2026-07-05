import { useEffect, useRef } from 'react';

export interface ParticleNetworkProps {
  className?: string;
  nodeCount?: number;
  connectionDistance?: number;
  maxConnections?: number;
  nodeColor?: string;
  lineColor?: string;
  pulseColor?: string;
  interactive?: boolean;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  depth: number;
  phase: number;
}

interface Pulse {
  from: number;
  to: number;
  progress: number;
  speed: number;
  width: number;
}

function getResponsiveConfig(width: number) {
  if (width < 640) {
    return { nodeCount: 28, connectionDistance: 95 };
  }
  if (width < 1024) {
    return { nodeCount: 48, connectionDistance: 120 };
  }
  return { nodeCount: 72, connectionDistance: 155 };
}

export default function ParticleNetwork({
  className = '',
  nodeCount: nodeCountProp,
  connectionDistance: connectionDistanceProp,
  maxConnections = 2,
  nodeColor = '#d4e8ff',
  lineColor = '110, 170, 255',
  pulseColor = '#8fd4ff',
  interactive = true,
}: ParticleNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, active: false, tx: 0, ty: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationId = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let width = 0;
    let height = 0;
    let time = 0;

    const initNodes = () => {
      const cfg = getResponsiveConfig(width);
      const count = nodeCountProp ?? cfg.nodeCount;
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        radius: 0.8 + Math.random() * 1.6,
        depth: 0.3 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      }));
      pulses = [];
    };

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent?.clientWidth ?? window.innerWidth;
      height = parent?.clientHeight ?? window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
    };

    const drawBackground = () => {
      const cx = width * 0.5;
      const cy = height * 0.38;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.65);
      g.addColorStop(0, 'rgba(20, 32, 58, 0.55)');
      g.addColorStop(0.35, 'rgba(10, 12, 18, 0.25)');
      g.addColorStop(1, 'rgba(6, 7, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    };

    const spawnPulse = (from: number, to: number) => {
      if (pulses.length > 24) return;
      pulses.push({
        from,
        to,
        progress: 0,
        speed: 0.003 + Math.random() * 0.004,
        width: 1 + Math.random() * 1.5,
      });
    };

    const draw = () => {
      time += 0.016;

      // Motion persistence — cinematic smear
      ctx.fillStyle = 'rgba(8, 9, 12, 0.22)';
      ctx.fillRect(0, 0, width, height);

      drawBackground();

      if (interactive) {
        mouseRef.current.tx += (mouseRef.current.x - mouseRef.current.tx) * 0.06;
        mouseRef.current.ty += (mouseRef.current.y - mouseRef.current.ty) * 0.06;
      }

      const cfg = getResponsiveConfig(width);
      const connectionDistance = connectionDistanceProp ?? cfg.connectionDistance;
      const connectionDistSq = connectionDistance * connectionDistance;

      for (const node of nodes) {
        const drift = Math.sin(time * 0.4 + node.phase) * 0.015;
        node.x += node.vx + drift;
        node.y += node.vy + drift * 0.6;

        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;

        if (interactive && mouseRef.current.active) {
          const dx = mouseRef.current.tx - node.x;
          const dy = mouseRef.current.ty - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 180 && dist > 1) {
            const force = ((180 - dist) / 180) * 0.008 * node.depth;
            node.vx += (dx / dist) * force;
            node.vy += (dy / dist) * force;
          }
        }

        node.vx *= 0.992;
        node.vy *= 0.992;
      }

      const connections: Array<[number, number, number]> = [];

      for (let i = 0; i < nodes.length; i++) {
        let linked = 0;
        for (let j = i + 1; j < nodes.length; j++) {
          if (linked >= maxConnections) break;
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < connectionDistSq) {
            connections.push([i, j, Math.sqrt(distSq)]);
            linked += 1;
            if (Math.random() < 0.0012) spawnPulse(i, j);
          }
        }
      }

      ctx.lineCap = 'round';

      for (const [i, j, dist] of connections) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const t = 1 - dist / connectionDistance;
        const alpha = 0.04 + t * 0.14;
        const avgDepth = (a.depth + b.depth) * 0.5;

        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, `rgba(${lineColor}, ${alpha * avgDepth})`);
        grad.addColorStop(0.5, `rgba(180, 210, 255, ${alpha * 1.2 * avgDepth})`);
        grad.addColorStop(1, `rgba(${lineColor}, ${alpha * avgDepth * 0.6})`);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.5 + t * 0.8;
        ctx.stroke();
      }

      for (const pulse of pulses) {
        pulse.progress += pulse.speed;
        if (pulse.progress >= 1) continue;

        const a = nodes[pulse.from]!;
        const b = nodes[pulse.to]!;
        const px = a.x + (b.x - a.x) * pulse.progress;
        const py = a.y + (b.y - a.y) * pulse.progress;

        for (let t = 0; t < 4; t++) {
          const trail = pulse.progress - t * 0.02;
          if (trail <= 0) continue;
          const tx = a.x + (b.x - a.x) * trail;
          const ty = a.y + (b.y - a.y) * trail;
          const r = pulse.width * (1 - t * 0.22);
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(142, 212, 255, ${0.35 - t * 0.08})`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(px, py, pulse.width + 1.2, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, pulse.width * 4);
        glow.addColorStop(0, pulseColor);
        glow.addColorStop(0.4, 'rgba(110, 188, 255, 0.35)');
        glow.addColorStop(1, 'rgba(110, 188, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fill();
      }
      pulses = pulses.filter((p) => p.progress < 1);

      for (const node of nodes) {
        const breathe = 1 + Math.sin(time * 1.2 + node.phase) * 0.15;
        const r = node.radius * node.depth * breathe * 1.4;
        const alpha = 0.35 + node.depth * 0.55;

        const halo = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 6);
        halo.addColorStop(0, `rgba(207, 228, 255, ${alpha * 0.9})`);
        halo.addColorStop(0.25, `rgba(41, 121, 255, ${alpha * 0.25})`);
        halo.addColorStop(1, 'rgba(41, 121, 255, 0)');

        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 6, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      animationId = requestAnimationFrame(draw);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        ...mouseRef.current,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    const onMouseLeave = () => {
      mouseRef.current.active = false;
    };

    resize();
    ctx.fillStyle = '#08090c';
    ctx.fillRect(0, 0, width, height);
    draw();

    window.addEventListener('resize', resize);
    if (interactive) {
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mouseleave', onMouseLeave);
    }

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      if (interactive) {
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mouseleave', onMouseLeave);
      }
    };
  }, [
    nodeCountProp,
    connectionDistanceProp,
    maxConnections,
    nodeColor,
    lineColor,
    pulseColor,
    interactive,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full ${className}`}
      aria-hidden
    />
  );
}
