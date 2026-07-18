'use client';

/**
 * WorkspaceFX — Ambient background layer + constellation particles + cursor FX
 *
 * Ports `assets/fx.js` (constellation behavior) from the handoff:
 *  1. Canvas constellation: multi-color dots connected by gold lines, repel on hover
 *  2. Cursor spotlight: 260px radial glow following pointermove
 *  3. Blob A — gold, top-right, blobA 26s
 *  4. Blob B — escudo red, bottom-left, blobB 32s
 *
 * Mouse interaction: particles are repelled from the cursor (140px radius, force 7).
 * All layers are pointer-events:none and aria-hidden. Skipped on prefers-reduced-motion.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

// Area palette — matches handoff AREA_COLORS
const PALETTE: [number, number, number][] = [
  [168, 56, 56],   // escudo
  [184, 147, 74],  // gold
  [61, 107, 126],  // verdad
  [90, 127, 122],  // futuro
  [53, 122, 40],   // pyme
];

interface Dot {
  x: number; y: number;
  vx: number; vy: number;
  r: number; a: number;
  c: [number, number, number];
}

function rand(a: number, b: number) { return a + Math.random() * (b - a); }

export function WorkspaceFX() {
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

    let W = 0, H = 0, DPR = 1;
    let dots: Dot[] = [];
    let raf = 0;
    const mouse = { x: -1e4, y: -1e4, on: false };

    /* ── sizing ─────────────────────────────────────────────── */
    function dims() {
      DPR = Math.min(devicePixelRatio || 1, 2);
      W = cv!.width  = innerWidth  * DPR;
      H = cv!.height = innerHeight * DPR;
      cv!.style.width  = innerWidth  + 'px';
      cv!.style.height = innerHeight + 'px';
    }

    /* ── particle factory ───────────────────────────────────── */
    function mkDot(): Dot {
      return {
        x: rand(0, W), y: rand(0, H),
        vx: rand(-0.3, 0.3) * DPR,
        vy: rand(-0.3, 0.3) * DPR,
        r: rand(1.4, 3) * DPR,
        a: rand(0.3, 0.55),
        c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      };
    }

    function build() {
      const n = Math.min(60, Math.floor(innerWidth / 20));
      dots = Array.from({ length: n }, mkDot);
    }

    /* ── repulsion ──────────────────────────────────────────── */
    function repel(p: Dot) {
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

    /* ── draw loop ──────────────────────────────────────────── */
    function frame() {
      ctx!.clearRect(0, 0, W, H);
      const D = 140 * DPR;

      for (const p of dots) {
        p.x += p.vx; p.y += p.vy; repel(p);
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      // Lines between nearby dots (gold, fading with distance)
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i], b = dots[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < D) {
            ctx!.strokeStyle = `rgba(184,147,74,${0.16 * (1 - d / D)})`;
            ctx!.lineWidth = 1.1 * DPR;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      // Dots
      for (const p of dots) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, 6.28);
        ctx!.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a})`;
        ctx!.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    /* ── pointer events (shared between canvas + spotlight) ─── */
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
  }, [prefersReduced]);

  if (prefersReduced) return null;

  return (
    <>
      {/* Constellation canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
      />

      {/* Blob A — gold, top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-0 rounded-full"
        style={{
          top: '-20vmax', right: '-12vmax',
          width: '46vmax', height: '46vmax',
          opacity: 0.5,
          filter: 'blur(48px)',
          willChange: 'transform',
          background: 'radial-gradient(circle, rgb(184 147 74 / .26), transparent 68%)',
          animation: 'blobA 26s ease-in-out infinite alternate',
        }}
      />

      {/* Blob B — escudo red, bottom-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-0 rounded-full"
        style={{
          bottom: '-18vmax', left: '-14vmax',
          width: '46vmax', height: '46vmax',
          opacity: 0.5,
          filter: 'blur(48px)',
          willChange: 'transform',
          background: 'radial-gradient(circle, rgb(168 56 56 / .14), transparent 68%)',
          animation: 'blobB 32s ease-in-out infinite alternate',
        }}
      />

      {/* Cursor spotlight */}
      <div
        ref={spotRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          opacity: 0,
          transition: 'opacity 0.35s ease',
          background: 'radial-gradient(260px circle at var(--fx-mx, -300px) var(--fx-my, -300px), rgba(184,147,74,.26), rgba(184,147,74,.09) 42%, transparent 72%)',
        }}
      />
    </>
  );
}
