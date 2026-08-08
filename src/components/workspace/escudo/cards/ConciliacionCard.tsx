'use client';

/**
 * ConciliacionCard — Módulo 2: Conciliación Fiscal Borrador.
 *
 * Tabla: UAI → adiciones → deducciones → renta líquida → impuesto bruto →
 *        descuentos → impuesto neto → retenciones → saldo.
 * Cada fila con su cita normativa (small text-n-600).
 * Banner: "Borrador — requiere revisión contador".
 */

import { Scale, Info } from 'lucide-react';
import { NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { ConciliacionModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import type { FiscalConciliacionT } from '../types';

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Tipo labels por tipo de línea
// ---------------------------------------------------------------------------

function tipoLabel(tipo: string, language: 'es' | 'en'): string {
  const MAP: Record<string, { es: string; en: string }> = {
    adicion: { es: 'Adición', en: 'Addition' },
    deduccion: { es: 'Deducción', en: 'Deduction' },
    renta_exenta: { es: 'Renta exenta', en: 'Exempt income' },
    incrgno: { es: 'Ingreso no const. renta', en: 'Non-taxable income' },
    descuento: { es: 'Descuento', en: 'Tax credit' },
    retencion: { es: 'Retención', en: 'Withholding' },
    anticipo: { es: 'Anticipo', en: 'Prepayment' },
  };
  return MAP[tipo]?.[language] ?? tipo;
}

function tipoColor(tipo: string): string {
  if (tipo === 'adicion') return 'text-danger';
  if (tipo === 'deduccion' || tipo === 'renta_exenta' || tipo === 'incrgno') return 'text-success';
  if (tipo === 'descuento' || tipo === 'retencion' || tipo === 'anticipo') return 'text-warning';
  return 'text-n-700';
}

interface ConciliacionCardProps {
  data?: ConciliacionModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalConciliacionT;
  language?: 'es' | 'en';
}

export function ConciliacionCard({ data, loading, error, t, language = 'es' }: ConciliacionCardProps) {
  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]',
      )}
      aria-labelledby="conciliacion-title"
      aria-busy={loading}
    >
      {/* Ambient glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -left-12 w-[180px] h-[180px] rounded-full blur-[64px] opacity-20"
        style={{ background: 'radial-gradient(circle, rgb(168 56 56 / 0.6) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo"
          >
            {loading ? <Shimmer className="h-5 w-5 rounded" /> : <Scale className="h-5 w-5" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <h3 id="conciliacion-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
              {t.title}
            </h3>
            <p className="text-xs text-n-500 mt-0.5">{t.subtitle}</p>
          </div>
        </div>
        {/* Draft badge */}
        {!loading && !error && (
          <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-label bg-[rgb(234_179_8_/_0.14)] text-warning ring-1 ring-[rgb(234_179_8_/_0.35)]">
            <Info className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {t.draftBadge}
          </span>
        )}
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* Draft banner */}
          <div
            className="flex items-start gap-2 rounded-md p-3 bg-[rgb(234_179_8_/_0.10)] ring-1 ring-[rgb(234_179_8_/_0.25)]"
            role="status"
          >
            <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-n-1000">{t.draftBanner}</p>
          </div>

          {/* Summary rows */}
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm border-collapse" aria-label={t.tableLabel}>
              <thead>
                <tr className="border-b border-n-200/40">
                  <th className="text-left py-1.5 pr-3 text-xs uppercase tracking-eyebrow text-n-500 font-medium">{t.colConcepto}</th>
                  <th className="text-right py-1.5 pr-3 text-xs uppercase tracking-eyebrow text-n-500 font-medium tabular-nums">{t.colMonto}</th>
                  <th className="text-left py-1.5 text-xs uppercase tracking-eyebrow text-n-500 font-medium hidden sm:table-cell">{t.colNorma}</th>
                </tr>
              </thead>
              <tbody>
                {/* UAI base */}
                <tr className="border-b border-n-200/20 font-semibold">
                  <td className="py-1.5 pr-3 text-n-1000">{language === 'es' ? 'UAI Contable (F01)' : 'Pre-tax Income (F01)'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-n-1000">{fmtCop(data.data.uaiContable)}</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Art. 26 E.T." /></td>
                </tr>

                {/* Líneas de ajuste */}
                {data.data.lineas.map((l, i) => (
                  <tr
                    key={i}
                    className="border-b border-n-200/20 hover:bg-n-50 transition-colors"
                  >
                    <td className="py-1.5 pr-3">
                      <span className="text-n-800">{l.concepto}</span>
                      <span className={cn('ml-1.5 text-[10px] font-medium uppercase', tipoColor(l.tipo))}>
                        {tipoLabel(l.tipo, language)}
                      </span>
                    </td>
                    <td className={cn('py-1.5 pr-3 text-right tabular-nums', tipoColor(l.tipo))}>
                      {fmtCop(l.monto)}
                    </td>
                    <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma={l.norma} /></td>
                  </tr>
                ))}

                {/* Subtotales */}
                <tr className="border-b border-n-200/40 font-semibold bg-n-50/50">
                  <td className="py-1.5 pr-3 text-n-1000">{language === 'es' ? 'Renta Líquida Gravable' : 'Taxable Net Income'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-n-1000">{fmtCop(data.data.rentaLiquidaGravable)}</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Art. 26 E.T." /></td>
                </tr>
                <tr className="border-b border-n-200/20">
                  <td className="py-1.5 pr-3 text-n-800">{language === 'es' ? `Tarifa (${fmtPct(data.data.tarifaPct)})` : `Rate (${fmtPct(data.data.tarifaPct)})`}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-n-800">{fmtCop(data.data.impuestoBruto)}</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Art. 240 E.T." /></td>
                </tr>
                <tr className="border-b border-n-200/20">
                  <td className="py-1.5 pr-3 text-n-800">{language === 'es' ? 'Descuentos' : 'Tax Credits'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-success">({fmtCop(data.data.totalDescuentos)})</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Arts. 254-257 E.T." /></td>
                </tr>
                <tr className="border-b border-n-200/40 font-semibold">
                  <td className="py-1.5 pr-3 text-n-1000">{language === 'es' ? 'Impuesto Neto' : 'Net Tax'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-n-1000">{fmtCop(data.data.impuestoNeto)}</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Art. 240 E.T." /></td>
                </tr>
                <tr className="border-b border-n-200/20">
                  <td className="py-1.5 pr-3 text-n-800">{language === 'es' ? 'Retenciones y Anticipos' : 'Withholdings & Prepayments'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-warning">({fmtCop(data.data.retencionesYAnticipos)})</td>
                  <td className="py-1.5 hidden sm:table-cell"><NormaCitation norma="Arts. 365-367 E.T." /></td>
                </tr>
                <tr className="font-bold text-base">
                  <td className="py-2 pr-3 text-n-1000">{language === 'es' ? 'Saldo Final' : 'Final Balance'}</td>
                  <td
                    className={cn(
                      'py-2 pr-3 text-right tabular-nums',
                      BigInt(data.data.saldoFinal) < BigInt(0) ? 'text-success' : 'text-danger',
                    )}
                  >
                    {fmtCop(data.data.saldoFinal)}
                    <span className="ml-1 text-xs font-normal text-n-500">
                      {BigInt(data.data.saldoFinal) < BigInt(0)
                        ? (language === 'es' ? '← a favor' : '← credit')
                        : (language === 'es' ? '← a pagar' : '← payable')}
                    </span>
                  </td>
                  <td className="py-2 hidden sm:table-cell"><NormaCitation norma="Art. 850 E.T." /></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Warnings */}
          {data.warnings.length > 0 && (
            <ul role="list" className="flex flex-col gap-1.5">
              {data.warnings.map((w, i) => (
                <li key={i} className="text-xs text-n-700 flex items-start gap-1.5">
                  <span aria-hidden="true" className="shrink-0 mt-1 h-1 w-1 rounded-full bg-warning" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40">
          <NormaCitation norma="Art. 26 + Art. 647 E.T." />
        </div>
      )}
    </article>
  );
}
