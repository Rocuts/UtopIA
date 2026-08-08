'use client';

import Link from 'next/link';
import { ArrowLeft, Shield, Bot, CalendarClock, Scale } from 'lucide-react';

const STATS = [
  { label: 'Vencimientos 30 días', value: '8', accent: false },
  { label: 'En riesgo', value: '2', accent: true },
  { label: 'Automatizados', value: '94%', accent: false },
];

const STREAM_LINES = [
  'Analizando el requerimiento ordinario de la DIAN para el año gravable 2024…',
  'Detecté una inconsistencia entre la declaración de renta y la información exógena reportada.',
  'Preparando borrador de respuesta con soporte en',
];

const CITATIONS = ['Art. 588 E.T.', 'Art. 651 E.T.', 'Decreto 2229/2023'];

const DEADLINES = [
  { title: 'Renta Grandes Contribuyentes — Cuota 3', days: '8 días', amount: '$380.000.000' },
  { title: 'Retención en la Fuente — Mayo', days: '15 días', amount: '$124.000.000' },
  { title: 'IVA Bimestral — Mar/Abr', days: '22 días', amount: '$89.000.000' },
  { title: 'ICA Bogotá — Bimestre 2', days: '30 días', amount: '$42.000.000' },
];

// POR QUÉ no hay variantes `dark:` en esta página: la escala n-0..n-1000 YA se
// invierte sola en [data-theme="dark"] (globals.css) y el @custom-variant `dark`
// dispara con EXACTAMENTE el mismo selector. Un `text-n-800 dark:text-n-200`
// se invierte dos veces: en oscuro renderiza n-200 = #27231D sobre fondo #0A0907
// (1.3:1 → invisible). El tinte se elige una sola vez, por ROL.
export default function AgenteFiscalPage() {
  return (
    <div className="min-h-screen bg-n-50 text-n-1000">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Back link */}
        <Link
          href="/workspace/escudo"
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-n-600 hover:text-n-1000 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Volver a El Escudo
        </Link>

        {/* Page heading */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-n-500">
            <Shield className="h-4 w-4" style={{ color: '#A83838' }} />
            <span>El Escudo — Agente Fiscal</span>
          </div>
          <h1 className="text-3xl font-bold text-n-1000">Agente Fiscal</h1>
          <p className="text-sm text-n-700 max-w-xl">
            Vigilancia tributaria en tiempo real. El agente analiza sus obligaciones y le avisa antes de cada vencimiento, con fundamento normativo.
          </p>
        </div>

        {/* Telemetry stats */}
        <section className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-n-500">Telemetría</div>
          <div className="grid grid-cols-3 gap-3">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-n-200 bg-n-0 p-4 space-y-1"
              >
                <div className="text-xs text-n-600">{s.label}</div>
                <div
                  className="text-2xl font-bold"
                  style={s.accent ? { color: '#A83838' } : undefined}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Live streaming panel */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest text-n-500">Análisis en progreso</div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: '#A83838' }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ backgroundColor: '#A83838' }}
                />
              </span>
              En vivo
            </span>
          </div>

          <div className="rounded-xl border border-n-200 bg-n-0 p-4 space-y-4">
            {STREAM_LINES.map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#A8383818' }}
                >
                  <Bot className="h-4 w-4" style={{ color: '#A83838' }} />
                </div>
                <div className="flex-1 text-sm text-n-900 bg-n-100 rounded-lg px-3 py-2 leading-relaxed">
                  {line}
                  {i === STREAM_LINES.length - 1 && (
                    <span className="inline-block w-0.5 h-4 ml-1 align-middle bg-n-700 animate-[blink_1s_step-end_infinite]" />
                  )}
                </div>
              </div>
            ))}

            {/* Citation chips */}
            <div className="flex flex-wrap gap-2 pl-10">
              {CITATIONS.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border"
                  style={{
                    color: '#A83838',
                    borderColor: '#A8383840',
                    backgroundColor: '#A8383810',
                  }}
                >
                  <Scale className="h-3 w-3" />
                  {c}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Upcoming deadlines */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-widest text-n-500">Próximos vencimientos</div>
            <span className="text-xs text-n-600">4 obligaciones</span>
          </div>

          <div className="rounded-xl border border-n-200 bg-n-0 divide-y divide-n-200">
            {DEADLINES.map((d, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div
                  className="flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: '#A8383812' }}
                >
                  <CalendarClock className="h-4 w-4" style={{ color: '#A83838' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-n-1000 truncate">{d.title}</div>
                  <div className="text-xs text-n-600 mt-0.5">en {d.days}</div>
                </div>
                <div className="text-sm font-mono font-semibold text-n-900 whitespace-nowrap">
                  {d.amount}
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
