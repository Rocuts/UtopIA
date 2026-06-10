'use client';

const STEPS = [
  {
    n: '01',
    title: 'Diagnóstico',
    desc: 'Analizamos su situación contable, tributaria y financiera con IA.',
  },
  {
    n: '02',
    title: 'Análisis profundo',
    desc: 'Cruzamos normativa, doctrina DIAN y mejores prácticas.',
  },
  {
    n: '03',
    title: 'Estrategia',
    desc: 'Diseñamos la ruta óptima con alternativas y escenarios.',
  },
  {
    n: '04',
    title: 'Entregable',
    desc: 'Borrador técnico, soporte probatorio y plan de acción.',
  },
];

export function Methodology() {
  return (
    <section
      id="methodology"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="text-xs uppercase tracking-[0.16em] text-n-500 font-medium block mb-3.5">
            Metodología
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Un proceso riguroso, de principio a fin.
          </h2>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[18px]">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="pt-3.5"
              style={{ borderTop: '2px solid var(--color-n-200)' }}
            >
              <div
                className="font-serif-elite font-normal text-gold-500"
                style={{ fontSize: '2.5rem', lineHeight: 1 }}
              >
                {step.n}
              </div>
              <h4
                className="font-semibold text-n-1000 mt-3 mb-1.5"
                style={{ fontSize: '0.9375rem' }}
              >
                {step.title}
              </h4>
              <p className="text-[0.8125rem] text-n-600 leading-snug">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
