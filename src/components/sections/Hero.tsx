'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface Mote {
  x: number; y: number; r: number;
  vx: number; vy: number; a: number; ph: number;
}

export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId: number;
    let W = 0, H = 0, DPR = 1;
    let t = 0;
    let motes: Mote[] = [];

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv!.width = innerWidth * DPR;
      H = cv!.height = innerHeight * DPR;
      cv!.style.width = innerWidth + 'px';
      cv!.style.height = innerHeight + 'px';
      const n = Math.min(70, Math.floor(innerWidth / 22));
      motes = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: (Math.random() * 1.6 + 0.4) * DPR,
        vx: (Math.random() - 0.5) * 0.12 * DPR,
        vy: (Math.random() - 0.5) * 0.12 * DPR,
        a: Math.random() * 0.5 + 0.15,
        ph: Math.random() * Math.PI * 2,
      }));
    }

    resize();
    window.addEventListener('resize', resize);

    const cx0 = () => W * 0.68;
    const cy0 = () => H * 0.22;

    function frame() {
      t += 0.004;
      ctx!.clearRect(0, 0, W, H);

      const arcs = [0.30, 0.46, 0.64, 0.86];
      arcs.forEach((rf, i) => {
        const R = Math.min(W, H) * rf;
        ctx!.beginPath();
        ctx!.arc(cx0(), cy0(), R, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(184,147,74,${0.10 - i * 0.012})`;
        ctx!.lineWidth = 1 * DPR;
        ctx!.stroke();
        const ang = t * (0.6 - i * 0.1) + i * 1.7;
        const nx = cx0() + Math.cos(ang) * R;
        const ny = cy0() + Math.sin(ang) * R;
        ctx!.beginPath();
        ctx!.arc(nx, ny, 2.2 * DPR, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(184,147,74,${0.6 - i * 0.1})`;
        ctx!.fill();
      });

      for (const m of motes) {
        m.x += m.vx; m.y += m.vy; m.ph += 0.02;
        if (m.x < 0) m.x = W; if (m.x > W) m.x = 0;
        if (m.y < 0) m.y = H; if (m.y > H) m.y = 0;
        const tw = m.a * (0.6 + 0.4 * Math.sin(m.ph));
        ctx!.beginPath();
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(154,122,56,${tw * 0.6})`;
        ctx!.fill();
      }

      if (!reduce) rafId = requestAnimationFrame(frame);
    }

    frame();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{
        background: [
          'radial-gradient(1100px 700px at 70% -10%, rgb(212 184 118 / .10), transparent 60%)',
          'radial-gradient(800px 600px at 0% 90%, rgb(214 107 107 / .05), transparent 55%)',
          'var(--n-0)',
        ].join(', '),
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Grain overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1] pointer-events-none opacity-[0.45]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(184 147 74 / .16) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(900px 600px at 60% 40%, #000 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(900px 600px at 60% 40%, #000 0%, transparent 75%)',
        }}
      />

      {/* Hero body */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5 pt-[72px]">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-3 mb-8">
          <span className="h-px w-7" style={{ background: 'rgb(212 184 118 / .5)' }} aria-hidden="true" />
          <span className="text-xs uppercase tracking-[0.16em] text-gold-500 font-medium">
            Consultoría Contable &amp; Tributaria — Colombia
          </span>
          <span className="h-px w-7" style={{ background: 'rgb(212 184 118 / .5)' }} aria-hidden="true" />
        </div>

        {/* Title */}
        <h1
          className="font-serif-elite font-medium text-n-1000 text-balance max-w-[15ch]"
          style={{
            fontSize: 'clamp(2.3rem, 5.2vw, 4.4rem)',
            lineHeight: 1.1,
            letterSpacing: '-0.025em',
            fontVariationSettings: "'opsz' 144, 'wght' 500",
          }}
        >
          La claridad financiera que su empresa{' '}
          <em
            className="text-gold-500"
            style={{
              fontStyle: 'italic',
              fontVariationSettings: "'opsz' 144, 'wght' 420, 'SOFT' 60, 'WONK' 1",
            }}
          >
            merece
          </em>
          .
        </h1>

        {/* Slogan */}
        <p
          className="font-serif-elite italic text-gold-600 mt-10"
          style={{
            fontSize: 'clamp(1rem, 2vw, 1.3rem)',
            fontVariationSettings: "'opsz' 20, 'wght' 400",
          }}
        >
          Tan sencillo como 1+1.
        </p>

        {/* Subtitle */}
        <p
          className="text-n-600 max-w-[52ch] mx-auto mt-[18px] text-balance"
          style={{ fontSize: 'clamp(1rem, 1.4vw, 1.2rem)', lineHeight: 1.65 }}
        >
          Defensa tributaria, devoluciones, due diligence y valoración — con la precisión de la IA y el criterio de una firma de asesoría elite.
        </p>

        {/* CTAs */}
        <div className="flex gap-3.5 mt-11 flex-wrap justify-center">
          <Link href="/workspace">
            <button className="inline-flex items-center gap-2 h-12 px-7 rounded-lg text-[0.9375rem] font-semibold bg-gold-500 hover:bg-gold-600 text-n-0 border border-black/10 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_22px_rgb(184_147_74_/_0.18)] active:scale-[0.98]">
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
              Acceder al workspace
            </button>
          </Link>
          <button
            className="inline-flex items-center h-12 px-7 rounded-lg text-[0.9375rem] font-medium bg-transparent text-gold-500 border transition-all duration-200 hover:text-gold-600 hover:bg-gold-500/10 hover:-translate-y-px active:scale-[0.98]"
            style={{ borderColor: 'rgb(212 184 118 / .4)' }}
            onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })}
          >
            Ver servicios
          </button>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-[122px] left-1/2 -translate-x-1/2 z-10 hidden flex-col items-center gap-2 text-n-500 [@media(min-height:820px)_and_(min-width:861px)]:flex">
        <div
          className="relative w-[22px] h-[34px] border-[1.5px] rounded-[12px]"
          style={{ borderColor: 'var(--n-400)' }}
        >
          <span
            className="absolute left-1/2 top-[7px] -translate-x-1/2 w-[3px] h-[6px] rounded-sm bg-gold-500"
            style={{ animation: 'scrolldot 1.6s ease infinite' }}
            aria-hidden="true"
          />
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em]">Explorar</span>
      </div>
    </section>
  );
}
