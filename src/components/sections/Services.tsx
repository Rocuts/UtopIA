'use client';

import { Shield, Banknote, FileSearch, Sparkles, Check } from 'lucide-react';

const SERVICES = [
  {
    Icon: Shield,
    title: 'Defensa ante la DIAN',
    desc: 'Requerimientos, pliegos de cargos y liquidaciones — con respuesta técnica y estrategia administrativa.',
    outcome: 'Defensa fundamentada y completa.',
  },
  {
    Icon: Banknote,
    title: 'Devolución de saldos a favor',
    desc: 'Recupere su caja con expedientes técnicos sólidos y acompañamiento ante la administración.',
    outcome: 'Expediente listo para radicar.',
  },
  {
    Icon: FileSearch,
    title: 'Due diligence & valoración',
    desc: 'Prepare su empresa para inversión, crédito o venta con modelación financiera y narrativa.',
    outcome: 'Informe listo para inversionistas.',
  },
  {
    Icon: Sparkles,
    title: 'NIIF Elite',
    desc: 'Reportes financieros bajo NIIF generados por IA, con estrategia y gobierno corporativo.',
    outcome: 'Reporte ejecutivo navegable.',
  },
];

export function Services() {
  return (
    <section
      id="services"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="text-xs uppercase tracking-[0.16em] text-n-500 font-medium block mb-3.5">
            Servicios
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Soluciones de clase mundial para la normativa colombiana.
          </h2>
        </div>

        {/* Service cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {SERVICES.map((s) => (
            <div
              key={s.title}
              className="group border border-n-200 rounded-xl p-6 bg-n-0 transition-all duration-200 hover:-translate-y-1 hover:border-gold-500/40 hover:shadow-[0_20px_40px_-24px_rgb(184_147_74_/_0.45)]"
            >
              {/* Icon */}
              <div className="w-11 h-11 rounded-lg grid place-items-center bg-gold-500/12 text-gold-600 mb-[18px]">
                <s.Icon className="w-[22px] h-[22px]" aria-hidden="true" />
              </div>

              <h3
                className="font-serif-elite font-medium text-n-1000 leading-snug"
                style={{ fontSize: '1.0625rem' }}
              >
                {s.title}
              </h3>
              <p className="text-[0.8125rem] text-n-600 mt-2 leading-snug">{s.desc}</p>

              {/* Outcome */}
              <div className="flex gap-1.5 mt-3.5 text-xs text-gold-700">
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                {s.outcome}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
