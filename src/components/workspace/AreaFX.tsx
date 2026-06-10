'use client';

/**
 * AreaFX — Area-tinted ambient FX layer
 *
 * Ports `assets/fx.js` (per-area behavior) + `assets/module.css` backgrounds.
 * One canvas per area page with the correct particle behavior + accent blobs.
 *
 * Behaviors:
 *   escudo  — rising particles with sway + dual-radius glow halo
 *   valor   — rising sparks (some cross-shaped) + floating dots
 *   verdad  — constellation (floating dots connected by accent lines)
 *   futuro  — horizontal sine-wave dots (trailing comet tails)
 *
 * Each behavior is repelled by the cursor (140px radius, force 7).
 * All layers are pointer-events:none and aria-hidden.
 * Skipped when prefers-reduced-motion is set.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import type { AreaAccent } from './layouts/AreaShell';

// ─── Per-area color config ────────────────────────────────────────────────────

interface AreaColors {
  r: number; g: number; b: number;
  r2: number; g2: number; b2: number;
}

const AREA_COLORS: Record<AreaAccent, AreaColors> = {
  escudo: { r: 168, g: 56,  b: 56,  r2: 138, g2: 46,  b2: 46  },
  valor:  { r: 184, g: 147, b: 74,  r2: 154, g2: 122, b2: 56  },
  verdad: { r: 61,  g: 107, b: 126, r2: 49,  g2: 88,  b2: 105 },
  futuro: { r: 90,  g: 127, b: 122, r2: 71,  g2: 102, b2: 97  },
  pyme:   { r: 53,  g: 122, b: 40,  r2: 42,  g2: 94,  b2: 31  },
};

// ─── Particle types ───────────────────────────────────────────────────────────

interface EscudoParticle {
  kind: 'escudo';
  x: number; y: number;
  vy: number; sway: number; ph: number;
  r: number; a: number;
}

interface ValorParticle {
  kind: 'valor';
  x: number; y: number;
  vy: number; ph: number;
  r: number; a: number;
  spark: boolean;
}

interface VerdadParticle {
  kind: 'verdad';
  x: number; y: number;
  vx: number; vy: number;
  r: number; a: number;
}

interface FuturoParticle {
  kind: 'futuro';
  x: number; y: number;
  base: number;
  vx: number; amp: number; freq: number; ph: number;
  r: number; a: number;
}

interface PymeParticle {
  kind: 'pyme';
  x: number; y: number;
  vy: number; sway: number; ph: number;
  r: number; a: number;
  spark: boolean;
}

type Particle = EscudoParticle | ValorParticle | VerdadParticle | FuturoParticle | PymeParticle;

function rand(a: number, b: number) { return a + Math.random() * (b - a); }

// ─── Component ────────────────────────────────────────────────────────────────

interface AreaFXProps {
  area: AreaAccent;
}

export function AreaFX({ area }: AreaFXProps) {
  const prefersReduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReduced) return;
    const cv = canvasRef.current;
    const spot = spotRef.current;
    if (!cv || !spot) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const { r, g, b, r2, g2, b2 } = AREA_COLORS[area];
    const col  = (a: number) => `rgba(${r},${g},${b},${a})`;
    const col2 = (a: number) => `rgba(${r2},${g2},${b2},${a})`;

    let W = 0, H = 0, DPR = 1;
    let particles: Particle[] = [];
    let raf = 0;
    const mouse = { x: -1e4, y: -1e4, on: false };

    function dims() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = cv!.width  = innerWidth  * DPR;
      H = cv!.height = innerHeight * DPR;
      cv!.style.width  = innerWidth  + 'px';
      cv!.style.height = innerHeight + 'px';
    }

    function spawnEscudo(init: boolean): EscudoParticle {
      return {
        kind: 'escudo',
        x: rand(0, W),
        y: init ? rand(0, H) : H + rand(0, 30 * DPR),
        vy: -rand(0.2, 0.7) * DPR,
        sway: rand(0.5, 1.4),
        ph: rand(0, 6.28),
        r: rand(1.1, 3.2) * DPR,
        a: rand(0.22, 0.5),
      };
    }

    function spawnValor(init: boolean): ValorParticle {
      return {
        kind: 'valor',
        x: rand(0, W),
        y: init ? rand(0, H) : H + rand(0, 20 * DPR),
        vy: -rand(0.3, 0.9) * DPR,
        ph: rand(0, 6.28),
        r: rand(1.1, 3) * DPR,
        a: rand(0.2, 0.46),
        spark: Math.random() < 0.24,
      };
    }

    function spawnVerdad(): VerdadParticle {
      return {
        kind: 'verdad',
        x: rand(0, W),
        y: rand(0, H),
        vx: rand(-0.35, 0.35) * DPR,
        vy: rand(-0.35, 0.35) * DPR,
        r: rand(2.8, 5.5) * DPR,
        a: rand(0.52, 0.82),
      };
    }

    function spawnFuturo(init: boolean): FuturoParticle {
      const y = init ? rand(0, H) : rand(0, H);
      return {
        kind: 'futuro',
        x: init ? rand(0, W) : -rand(0, 40 * DPR),
        y,
        base: y,
        vx: rand(0.5, 1.4) * DPR,
        amp: rand(10, 46) * DPR,
        freq: rand(0.002, 0.006),
        ph: rand(0, 6.28),
        r: rand(1.5, 3.2) * DPR,
        a: rand(0.28, 0.55),
      };
    }

    function spawnPyme(init: boolean): PymeParticle {
      return {
        kind: 'pyme',
        x: rand(0, W),
        y: init ? rand(0, H) : H + rand(0, 20 * DPR),
        vy: -rand(0.25, 0.75) * DPR,
        sway: rand(0.4, 1.2),
        ph: rand(0, 6.28),
        r: rand(2.8, 5.5) * DPR,
        a: rand(0.50, 0.80),
        spark: Math.random() < 0.35,
      };
    }

    function build() {
      const dens = innerWidth / (area === 'verdad' ? 20 : 12);
      const n = Math.min(area === 'verdad' ? 60 : 130, Math.floor(dens));
      if (area === 'escudo') particles = Array.from({ length: n }, () => spawnEscudo(true));
      else if (area === 'valor') particles = Array.from({ length: n }, () => spawnValor(true));
      else if (area === 'verdad') particles = Array.from({ length: n }, () => spawnVerdad());
      else if (area === 'pyme') particles = Array.from({ length: n }, () => spawnPyme(true));
      else particles = Array.from({ length: n }, () => spawnFuturo(true));
    }

    function repel(p: { x: number; y: number }) {
      if (!mouse.on) return;
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const R = 140 * DPR, d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        const f = (1 - d / R) * 7 * DPR;
        p.x += (dx / d) * f;
        p.y += (dy / d) * f;
      }
    }

    function frame() {
      ctx!.clearRect(0, 0, W, H);

      if (area === 'escudo') {
        for (const p of particles as EscudoParticle[]) {
          p.ph += 0.03;
          p.y += p.vy;
          p.x += Math.sin(p.ph) * p.sway * DPR * 0.3;
          repel(p);
          const tw = p.a * (0.55 + 0.45 * Math.sin(p.ph * 1.7));
          // Inner dot
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r, 0, 6.28);
          ctx!.fillStyle = col(tw);
          ctx!.fill();
          // Outer glow halo
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r * 2.4, 0, 6.28);
          ctx!.fillStyle = col(tw * 0.12);
          ctx!.fill();
          if (p.y < -10 * DPR) Object.assign(p, spawnEscudo(false));
        }
      } else if (area === 'valor') {
        for (const p of particles as ValorParticle[]) {
          p.y += p.vy;
          p.ph += 0.06;
          repel(p);
          if (p.spark) {
            const s = p.r * 1.8;
            const tw = p.a * (0.5 + 0.5 * Math.sin(p.ph));
            ctx!.strokeStyle = col2(tw);
            ctx!.lineWidth = 1.2 * DPR;
            ctx!.beginPath();
            ctx!.moveTo(p.x - s, p.y); ctx!.lineTo(p.x + s, p.y);
            ctx!.moveTo(p.x, p.y - s); ctx!.lineTo(p.x, p.y + s);
            ctx!.stroke();
          } else {
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, p.r, 0, 6.28);
            ctx!.fillStyle = col(p.a);
            ctx!.fill();
          }
          if (p.y < -10 * DPR) Object.assign(p, spawnValor(false));
        }
      } else if (area === 'verdad') {
        const D = 140 * DPR;
        for (const p of particles as VerdadParticle[]) {
          p.x += p.vx; p.y += p.vy;
          repel(p);
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
        }
        const vp = particles as VerdadParticle[];
        for (let i = 0; i < vp.length; i++) {
          for (let j = i + 1; j < vp.length; j++) {
            const d = Math.hypot(vp[i].x - vp[j].x, vp[i].y - vp[j].y);
            if (d < D) {
              ctx!.strokeStyle = col(0.38 * (1 - d / D));
              ctx!.lineWidth = 1.3 * DPR;
              ctx!.beginPath();
              ctx!.moveTo(vp[i].x, vp[i].y);
              ctx!.lineTo(vp[j].x, vp[j].y);
              ctx!.stroke();
            }
          }
        }
        for (const p of vp) {
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r, 0, 6.28);
          ctx!.fillStyle = col(p.a);
          ctx!.fill();
        }
      } else if (area === 'pyme') {
        for (const p of particles as PymeParticle[]) {
          p.ph += 0.04;
          p.y += p.vy;
          p.x += Math.sin(p.ph) * p.sway * DPR * 0.25;
          repel(p);
          if (p.spark) {
            const s = p.r * 2.2;
            const tw = p.a * (0.6 + 0.4 * Math.sin(p.ph));
            ctx!.strokeStyle = col(tw);
            ctx!.lineWidth = 1.5 * DPR;
            ctx!.beginPath();
            ctx!.moveTo(p.x - s, p.y); ctx!.lineTo(p.x + s, p.y);
            ctx!.moveTo(p.x, p.y - s); ctx!.lineTo(p.x, p.y + s);
            ctx!.stroke();
          } else {
            const tw = p.a * (0.65 + 0.35 * Math.sin(p.ph * 1.5));
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, p.r, 0, 6.28);
            ctx!.fillStyle = col(tw);
            ctx!.fill();
          }
          if (p.y < -10 * DPR) Object.assign(p, spawnPyme(false));
        }
      } else {
        // futuro
        for (const p of particles as FuturoParticle[]) {
          p.x += p.vx;
          p.y = p.base + Math.sin(p.x * p.freq + p.ph) * p.amp;
          for (let k = 0; k < 4; k++) {
            const xx = p.x - k * 7 * DPR;
            const yy = p.base + Math.sin(xx * p.freq + p.ph) * p.amp;
            ctx!.beginPath();
            ctx!.arc(xx, yy, p.r * (1 - k * 0.18), 0, 6.28);
            ctx!.fillStyle = col(p.a * (1 - k * 0.24));
            ctx!.fill();
          }
          if (p.x > W + 30 * DPR) Object.assign(p, spawnFuturo(false));
        }
      }

      raf = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      mouse.x = e.clientX * DPR;
      mouse.y = e.clientY * DPR;
      mouse.on = true;
      spot!.style.setProperty('--fx-mx', e.clientX + 'px');
      spot!.style.setProperty('--fx-my', e.clientY + 'px');
      spot!.style.opacity = '1';
    }
    function onLeave() {
      mouse.on = false;
      spot!.style.opacity = '0';
    }
    function onResize() { dims(); build(); }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);

    dims(); build(); frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [area, prefersReduced]);

  if (prefersReduced) return null;

  const { r, g, b, r2, g2, b2 } = AREA_COLORS[area];

  return (
    <>
      {/* Particles canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
      />

      {/* Blob A — accent, top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-0 rounded-full"
        style={{
          top: '-20vmax', right: '-12vmax',
          width: '48vmax', height: '48vmax',
          opacity: 0.55,
          filter: 'blur(46px)',
          willChange: 'transform',
          background: `radial-gradient(circle, rgba(${r},${g},${b},.30), transparent 68%)`,
          animation: 'blobA 24s ease-in-out infinite alternate',
        }}
      />

      {/* Blob B — deep accent, bottom-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-0 rounded-full"
        style={{
          bottom: '-18vmax', left: '-14vmax',
          width: '48vmax', height: '48vmax',
          opacity: 0.55,
          filter: 'blur(46px)',
          willChange: 'transform',
          background: `radial-gradient(circle, rgba(${r2},${g2},${b2},.26), transparent 68%)`,
          animation: 'blobB 30s ease-in-out infinite alternate',
        }}
      />

      {/* Cursor spotlight — follows pointermove */}
      <div
        ref={spotRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          opacity: 0,
          transition: 'opacity 0.35s ease',
          background: `radial-gradient(260px circle at var(--fx-mx, -300px) var(--fx-my, -300px), rgba(${r},${g},${b},.22), rgba(${r},${g},${b},.07) 42%, transparent 72%)`,
        }}
      />
    </>
  );
}
