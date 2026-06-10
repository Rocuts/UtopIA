'use client';

import Link from 'next/link';
import { Shield, TrendingUp, Scale, Compass } from 'lucide-react';

// Pre-calculated sparkline SVG paths (viewBox="0 0 240 40", pad=3)
const SPARKS = {
  escudo: {
    line: 'M3 3 L42 10.1 L81 17.2 L120 24.3 L159 27.8 L198 34.9 L237 37',
    fill: 'M3 3 L42 10.1 L81 17.2 L120 24.3 L159 27.8 L198 34.9 L237 37 L237 37 L3 37 Z',
    color: '#A83838',
  },
  valor: {
    line: 'M3 37 L42 33.6 L81 30.2 L120 24.3 L159 18.3 L198 9.8 L237 3',
    fill: 'M3 37 L42 33.6 L81 30.2 L120 24.3 L159 18.3 L198 9.8 L237 3 L237 37 L3 37 Z',
    color: '#B8934A',
  },
  verdad: {
    line: 'M3 37 L42 29.7 L81 22.4 L120 15.1 L159 10.3 L198 5.4 L237 3',
    fill: 'M3 37 L42 29.7 L81 22.4 L120 15.1 L159 10.3 L198 5.4 L237 3 L237 37 L3 37 Z',
    color: '#3D6B7E',
  },
  futuro: {
    line: 'M3 37 L42 30.2 L81 24.3 L120 18.3 L159 11.5 L198 6.4 L237 3',
    fill: 'M3 37 L42 30.2 L81 24.3 L120 18.3 L159 11.5 L198 6.4 L237 3 L237 37 L3 37 Z',
    color: '#5A7F7A',
  },
};

type PillarKey = keyof typeof SPARKS;

const PILLARS: {
  key: PillarKey;
  eyebrow: string;
  title: string;
  metric: string;
  label: string;
  Icon: typeof Shield;
  href: string;
}[] = [
  {
    key: 'escudo',
    eyebrow: 'I · Resiliencia',
    title: 'El Escudo',
    metric: '28,4%',
    label: 'Tasa Efectiva de Tributación',
    Icon: Shield,
    href: '/workspace',
  },
  {
    key: 'valor',
    eyebrow: 'II · Valor',
    title: 'El Valor',
    metric: '$4.820M',
    label: 'Valor de salida (DCF)',
    Icon: TrendingUp,
    href: '/workspace',
  },
  {
    key: 'verdad',
    eyebrow: 'III · Rigor',
    title: 'La Verdad',
    metric: '94/100',
    label: 'Score de Cumplimiento',
    Icon: Scale,
    href: '/workspace',
  },
  {
    key: 'futuro',
    eyebrow: 'IV · Prospectiva',
    title: 'El Futuro',
    metric: '28 meses',
    label: 'Runway · escenario base',
    Icon: Compass,
    href: '/workspace',
  },
];

function Sparkline({ id }: { id: PillarKey }) {
  const s = SPARKS[id];
  return (
    <svg width="100%" height="40" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={s.fill} fill={s.color} opacity={0.10} />
      <path d={s.line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function WorkspaceTeaser() {
  return (
    <section
      id="workspace"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="inline-flex items-center gap-2.5 text-gold-600 mb-3.5 justify-center">
            <span className="w-[18px] h-px bg-current" aria-hidden="true" />
            <span className="text-xs uppercase tracking-[0.16em] font-medium">El workspace</span>
            <span className="w-[18px] h-px bg-current" aria-hidden="true" />
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Cuatro áreas. Una sola verdad financiera.
          </h2>
          <p className="text-n-600 mt-3.5 leading-[1.65]" style={{ fontSize: '1.0625rem' }}>
            Inteligencia tributaria, valoración, aseguramiento y prospectiva — unificadas en un command center con telemetría en vivo.
          </p>
        </div>

        {/* Area cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PILLARS.map((p) => {
            const c = SPARKS[p.key].color;
            return (
              <Link
                key={p.key}
                href={p.href}
                className="group block border border-n-200 rounded-xl p-5 bg-n-0 relative overflow-hidden transition-all duration-200"
                style={
                  {
                    '--c': c,
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.transform = 'translateY(-5px)';
                  el.style.borderColor = c;
                  el.style.boxShadow = `0 22px 40px -24px ${c}8c`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.transform = '';
                  el.style.borderColor = '';
                  el.style.boxShadow = '';
                }}
              >
                {/* Colored top bar */}
                <span
                  className="absolute left-0 top-0 right-0 h-1 rounded-t-xl"
                  style={{ background: c }}
                  aria-hidden="true"
                />

                {/* Eyebrow + icon */}
                <div className="flex items-center justify-between mt-1.5 mb-3.5">
                  <span
                    className="text-[0.625rem] font-bold uppercase tracking-[0.16em]"
                    style={{ color: c }}
                  >
                    {p.eyebrow}
                  </span>
                  <span
                    className="w-9 h-9 rounded-lg grid place-items-center"
                    style={{ background: c }}
                    aria-hidden="true"
                  >
                    <p.Icon className="w-[18px] h-[18px] text-white" />
                  </span>
                </div>

                {/* Title */}
                <h3
                  className="font-serif-elite font-medium text-n-1000"
                  style={{ fontSize: '1.25rem' }}
                >
                  {p.title}
                </h3>

                {/* Metric */}
                <div className="font-mono font-semibold text-n-1000 mt-2" style={{ fontSize: '1.0625rem' }}>
                  {p.metric}
                </div>
                <div className="text-xs text-n-500">{p.label}</div>

                {/* Sparkline */}
                <div className="mt-2.5">
                  <Sparkline id={p.key} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
