'use client';

import { Bot, Sparkles } from 'lucide-react';

const PHASES = [
  {
    n: '1',
    title: 'NIIF',
    desc: 'Lectura de estados financieros y normalización contable.',
    agent: 'Agente Contable',
    active: true,
  },
  {
    n: '2',
    title: 'Strategy',
    desc: 'Optimización tributaria y modelado de escenarios.',
    agent: 'Agente Fiscal',
    active: false,
  },
  {
    n: '3',
    title: 'Governance',
    desc: 'Aseguramiento, control interno y dictamen.',
    agent: 'Agente Auditor',
    active: false,
  },
  {
    n: '4',
    title: 'HTML',
    desc: 'Reporte ejecutivo navegable, con diff entre versiones.',
    agent: 'Agente Editor',
    active: false,
  },
];

export function PipelineShowcase() {
  return (
    <section
      id="pipeline"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="inline-flex items-center gap-2 text-gold-600 mb-3.5 justify-center">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="text-xs uppercase tracking-[0.16em] font-medium">Pipeline NIIF Elite</span>
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Informes generados por agentes de IA.
          </h2>
          <p className="text-n-600 mt-3.5 leading-[1.65]" style={{ fontSize: '1.0625rem' }}>
            Del intake al reporte: cuatro fases orquestadas por agentes especializados, con streaming en tiempo real y citas legales verificables.
          </p>
        </div>

        {/* Phase cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {PHASES.map((phase) => (
            <div
              key={phase.n}
              className="bg-n-0 border border-n-200 rounded-xl p-5 relative"
            >
              {/* Phase number circle */}
              <div
                className="w-[34px] h-[34px] rounded-full grid place-items-center font-mono font-semibold mb-3.5"
                style={{
                  fontSize: '0.8125rem',
                  ...(phase.active
                    ? {
                        background: 'var(--color-gold-500)',
                        color: 'var(--color-n-0)',
                        boxShadow: '0 0 22px rgb(184 147 74 / 0.18)',
                      }
                    : {
                        background: 'rgb(184 147 74 / .14)',
                        color: 'var(--color-gold-600)',
                        border: '1px solid rgb(184 147 74 / .35)',
                      }),
                }}
              >
                {phase.n}
              </div>

              <h4 className="text-[0.9375rem] font-semibold text-n-1000">{phase.title}</h4>
              <p className="text-[0.8125rem] text-n-600 mt-1 leading-snug">{phase.desc}</p>

              {/* Agent badge */}
              <div className="inline-flex items-center gap-1.5 mt-3 text-[0.625rem] uppercase tracking-[0.1em] text-gold-600 font-semibold">
                <Bot className="w-[13px] h-[13px]" aria-hidden="true" />
                {phase.agent}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
