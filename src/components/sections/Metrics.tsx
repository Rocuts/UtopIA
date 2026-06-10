'use client';

const STATS = [
  { value: '+500', label: 'Casos resueltos' },
  { value: '$2,4B', gold: true, label: 'Ahorro fiscal generado' },
  { value: '98,7%', label: 'Precisión normativa' },
  { value: '<24h', label: 'Respuesta inicial' },
];

export function Metrics() {
  return (
    <section
      id="metrics"
      className="border-t border-n-200"
      style={{ padding: '84px clamp(22px, 5vw, 56px)' }}
    >
      <div className="max-w-[1180px] mx-auto">
        {/* Section header */}
        <div className="text-center max-w-[60ch] mx-auto mb-12">
          <span className="text-xs uppercase tracking-[0.16em] text-n-500 font-medium block mb-3.5">
            Resultados
          </span>
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{
              fontSize: 'clamp(1.9rem, 3.4vw, 2.8rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            Respaldados por datos, no por promesas.
          </h2>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-6 text-center">
          {STATS.map((s) => (
            <div key={s.label} className="mstat">
              <div
                className="font-serif-elite font-medium text-n-1000"
                style={{ fontSize: 'clamp(2.4rem, 4vw, 3.2rem)', lineHeight: 1 }}
              >
                {s.gold ? (
                  <span className="text-gold-600">{s.value}</span>
                ) : (
                  s.value
                )}
              </div>
              <div className="text-[0.8125rem] text-n-600 mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
