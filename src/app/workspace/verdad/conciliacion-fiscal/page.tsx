'use client';

import Link from 'next/link';
import { ArrowLeft, Scale } from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Diferencias', value: '3', accent: false },
  { label: 'Conciliado', value: '97%', accent: true },
  { label: 'Partidas', value: '1.204', accent: false },
];

interface Row {
  cuenta: string;
  contable: string;
  fiscal: string;
  diferencia: string;
  negative: boolean;
}

const ROWS: Row[] = [
  {
    cuenta: 'Gastos no deducibles',
    contable: '$840.000.000',
    fiscal: '$680.000.000',
    diferencia: '$160.000.000',
    negative: false,
  },
  {
    cuenta: 'Depreciación diferida',
    contable: '$1.240.000.000',
    fiscal: '$1.380.000.000',
    diferencia: '−$140.000.000',
    negative: true,
  },
  {
    cuenta: 'Provisiones',
    contable: '$420.000.000',
    fiscal: '$380.000.000',
    diferencia: '$40.000.000',
    negative: false,
  },
];

// ─── Accent colour ────────────────────────────────────────────────────────────
// verdad teal: #3D6B7E

export default function ConciliacionFiscalPage() {
  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[960px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">

        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-n-500 hover:text-n-800 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Volver a La Verdad
        </Link>

        {/* Sub-heading */}
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em]" style={{ color: '#3D6B7E' }}>
            <Scale className="w-4 h-4" aria-hidden="true" />
            <span>La Verdad — Conciliación Fiscal</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-n-1000 leading-tight">
            Conciliación Fiscal
          </h1>
          <p className="text-n-700 text-base leading-relaxed max-w-[640px]">
            Cruzamos su contabilidad con las declaraciones, partida por partida, para que sus cifras resistan cualquier revisión.
          </p>
        </div>

        {/* Stats row */}
        <section>
          <p className="text-xs uppercase tracking-[0.2em] text-n-600 mb-3">Estado</p>
          <div className="grid grid-cols-3 gap-4">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-n-200 bg-n-100/60 px-5 py-4 flex flex-col gap-2"
              >
                <span className="text-xs text-n-600 uppercase tracking-[0.16em]">{s.label}</span>
                {s.accent ? (
                  <div className="flex flex-col gap-1.5">
                    <span
                      className="text-2xl font-semibold tabular-nums leading-none"
                      style={{ color: '#3D6B7E' }}
                    >
                      {s.value}
                    </span>
                    {/* Progress bar */}
                    <div className="h-1.5 w-full rounded-full bg-n-200 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: '97%', backgroundColor: '#3D6B7E' }}
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-2xl font-semibold tabular-nums leading-none text-n-1000">
                    {s.value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Differences table */}
        <section>
          <p className="text-xs uppercase tracking-[0.2em] text-n-600 mb-3">
            Diferencias detectadas
          </p>
          <div className="rounded-xl border border-n-200 bg-n-100/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-n-200 text-xs uppercase tracking-[0.14em] text-n-600">
                    <th className="text-left px-5 py-3 font-medium">Cuenta</th>
                    <th className="text-right px-5 py-3 font-medium">Saldo contable</th>
                    <th className="text-right px-5 py-3 font-medium">Saldo fiscal</th>
                    <th className="text-right px-5 py-3 font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, idx) => (
                    <tr
                      key={row.cuenta}
                      className={
                        idx < ROWS.length - 1 ? 'border-b border-n-200' : ''
                      }
                    >
                      <td className="px-5 py-3.5 font-medium text-n-1000">
                        {row.cuenta}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-n-800">
                        {row.contable}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-n-800">
                        {row.fiscal}
                      </td>
                      <td
                        className="px-5 py-3.5 text-right font-mono font-semibold"
                        style={{ color: row.negative ? '#B45350' : '#3D6B7E' }}
                      >
                        {row.diferencia}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Note */}
        <p className="text-xs text-n-600 leading-relaxed">
          Validado según E.T. Arts. 107, 128 y 158-3. Cifras en COP millones.
        </p>

      </div>
    </div>
  );
}
