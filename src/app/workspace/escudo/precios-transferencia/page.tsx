'use client';

import Link from 'next/link';
import { Network, ChevronLeft, ClipboardList } from 'lucide-react';

const ACCENT = '#A83838';

const stats = [
  { label: 'Operaciones vinculadas', value: '12', accent: false },
  { label: 'Documentadas', value: '10', accent: false },
  { label: 'Pendientes', value: '2', accent: true },
];

const operations = [
  {
    operacion: 'Compra de inventario',
    vinculado: 'Vinculado MX',
    monto: '$2.840M',
    metodo: 'PPC',
  },
  {
    operacion: 'Servicios intragrupo',
    vinculado: 'Vinculado US',
    monto: '$620M',
    metodo: 'MTFCU',
  },
  {
    operacion: 'Regalías de marca',
    vinculado: 'Vinculado ES',
    monto: '$380M',
    metodo: 'MCU',
  },
];

export default function PreciosTransferenciaPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute top-[10%] -left-[10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-20"
          style={{
            background: `radial-gradient(circle, ${ACCENT}55 0%, transparent 70%)`,
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-6 pb-24">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/workspace/escudo"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-1000 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Volver a El Escudo
          </Link>
        </div>

        {/* Heading */}
        <div className="mb-8 flex items-start gap-4">
          <div
            aria-hidden="true"
            className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ background: `${ACCENT}22`, color: ACCENT }}
          >
            <Network className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: ACCENT }}>
              El Escudo — Precios de Transferencia
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold text-n-1000 leading-tight">
              Precios de Transferencia
            </h1>
            <p className="mt-1.5 text-sm text-n-700 leading-relaxed max-w-xl">
              Documentamos y analizamos sus operaciones con vinculados del exterior bajo el régimen colombiano.
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-n-200/60 bg-n-100/40 px-4 py-4 flex flex-col gap-1"
            >
              <span className="text-xs text-n-600 leading-snug">{s.label}</span>
              <span
                className="text-2xl font-bold tabular-nums leading-none"
                style={s.accent ? { color: ACCENT } : undefined}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* Operations table */}
        <div className="mb-8 rounded-xl border border-n-200/60 bg-n-100/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-n-200/60">
            <span className="text-sm font-semibold text-n-1000">Operaciones</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-n-200/60">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-n-600">
                    Operación
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-n-600">
                    Vinculado
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-n-600">
                    Monto
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-n-600">
                    Método
                  </th>
                </tr>
              </thead>
              <tbody>
                {operations.map((row, i) => (
                  <tr
                    key={row.operacion}
                    className={i < operations.length - 1 ? 'border-b border-n-200/40' : ''}
                  >
                    <td className="px-4 py-3 font-medium text-n-1000">{row.operacion}</td>
                    <td className="px-4 py-3 text-n-700">{row.vinculado}</td>
                    <td className="px-4 py-3 text-right font-mono text-n-800">{row.monto}</td>
                    <td className="px-4 py-3 text-n-700">{row.metodo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Callout */}
        <div
          className="rounded-xl border px-5 py-4 flex gap-3"
          style={{ borderColor: `${ACCENT}40`, background: `${ACCENT}0d` }}
        >
          <ClipboardList
            className="h-5 w-5 shrink-0 mt-0.5"
            style={{ color: ACCENT }}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div>
            <div className="text-sm font-semibold text-n-1000 mb-1">
              Vencimiento F.120 — 31 julio 2026
            </div>
            <p className="text-sm text-n-700 leading-relaxed">
              Informe local con documentación de soporte obligatorio (Art. 260-5 E.T.).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
