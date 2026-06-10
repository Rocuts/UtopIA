'use client';

import { BookMarked, Landmark, Scale, ShieldCheck } from 'lucide-react';

const CHIPS = [
  { Icon: BookMarked, label: 'Estatuto Tributario' },
  { Icon: Landmark, label: 'Doctrina DIAN' },
  { Icon: Scale, label: 'Normas NIIF / NIC' },
  { Icon: ShieldCheck, label: 'Ley 1581 de Protección de Datos' },
];

export function Trust() {
  return (
    <section
      id="trust"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="text-xs uppercase tracking-[0.16em] text-n-500 font-medium block mb-3.5">
            Marco normativo
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Fundamentado en normativa colombiana vigente.
          </h2>
          <p className="text-n-600 mt-3.5 leading-[1.65]" style={{ fontSize: '1.0625rem' }}>
            Cada análisis se genera exclusivamente a partir de fuentes oficiales y regulación al día.
          </p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap justify-center gap-3">
          {CHIPS.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-2 py-2.5 px-4 rounded-full border border-n-200 bg-n-0 text-[0.8125rem] text-n-700 font-medium"
            >
              <chip.Icon className="w-[15px] h-[15px] text-gold-600 shrink-0" aria-hidden="true" />
              {chip.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
