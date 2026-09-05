'use client';

/**
 * CcvFiscalCard — Módulo 1: Cuadro de Control de Variables Fiscales (F01-F10).
 *
 * Muestra el cuadro F01-F10 en un grid 2 columnas + alerta TET si F09 < 15%
 * (Art. 10 Ley 2277/2022). Color F09: verde ≥ 25%, ámbar 15-25%, rojo < 15%.
 */

import { BarChart3, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { AlertIndicator, NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { CcvModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import type { FiscalCcvT } from '../types';

// ---------------------------------------------------------------------------
// Money format helper — MoneyCop string → presentable COP
// ---------------------------------------------------------------------------

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function fmtPct(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(n);
}

// F09 color thresholds (Art. 10 Ley 2277/2022 — tasa mínima 15%)
function f09Color(pct: number): string {
  if (pct < 15) return 'text-danger';
  if (pct < 25) return 'text-warning';
  return 'text-success';
}

function f09AlertLevel(pct: number): 'rojo' | 'amarillo' | 'verde' {
  if (pct < 15) return 'rojo';
  if (pct < 25) return 'amarillo';
  return 'verde';
}

// ---------------------------------------------------------------------------
// Row type for the F01-F10 table
// ---------------------------------------------------------------------------

interface FRow {
  key: string;
  label: string;
  value: string;
  norma: string;
  isMoney?: boolean;
  isPct?: boolean;
  bold?: boolean;
}

// ---------------------------------------------------------------------------
// Shimmer
// ---------------------------------------------------------------------------

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30', className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CcvFiscalCardProps {
  data?: CcvModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalCcvT;
  language?: 'es' | 'en';
}

export function CcvFiscalCard({ data, loading, error, t, language = 'es' }: CcvFiscalCardProps) {
  const f09Alert = data ? f09AlertLevel(data.data.f09Pct) : 'verde';

  const rows: FRow[] = data
    ? [
        { key: 'f01', label: t.f01, value: fmtCop(data.data.f01), norma: 'Art. 26 E.T.', isMoney: true },
        { key: 'f02', label: t.f02, value: fmtCop(data.data.f02), norma: 'Art. 240 E.T.', isMoney: true, bold: true },
        { key: 'f03', label: t.f03, value: fmtCop(data.data.f03), norma: 'Cta. 1355', isMoney: true },
        { key: 'f04', label: t.f04, value: fmtCop(data.data.f04), norma: 'Art. 850 E.T.', isMoney: true, bold: true },
        { key: 'f05', label: t.f05, value: fmtCop(data.data.f05), norma: 'Cta. 2408', isMoney: true },
        { key: 'f06', label: t.f06, value: fmtCop(data.data.f06), norma: 'Cta. 2365', isMoney: true },
        { key: 'f07', label: t.f07, value: fmtCop(data.data.f07), norma: 'Cta. 2368', isMoney: true },
        { key: 'f08', label: t.f08, value: fmtCop(data.data.f08), norma: 'Cta. 24XX', isMoney: true, bold: true },
        { key: 'f09', label: t.f09, value: fmtPct(data.data.f09Pct / 100), norma: language === 'es' ? 'Razón contable: impuesto / UAI' : 'Accounting ratio: tax / pre-tax income', isPct: true },
        { key: 'f10', label: t.f10, value: fmtPct(data.data.f10Pct / 100), norma: 'Art. 240 E.T.', isPct: true },
      ]
    : [];

  const EficienciaIcon =
    data?.data.eficienciaFiscal === 'alta'
      ? TrendingUp
      : data?.data.eficienciaFiscal === 'baja'
      ? TrendingDown
      : Minus;

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1',
        f09Alert === 'rojo'
          ? 'ring-[rgb(239_68_68_/_0.3)]'
          : f09Alert === 'amarillo'
          ? 'ring-[rgb(234_179_8_/_0.28)]'
          : 'ring-[rgb(34_197_94_/_0.25)]',
      )}
      aria-labelledby="ccv-fiscal-title"
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
            {loading ? <Shimmer className="h-5 w-5 rounded" /> : <BarChart3 className="h-5 w-5" strokeWidth={1.75} />}
          </span>
          <div className="min-w-0">
            <h3 id="ccv-fiscal-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
              {t.title}
            </h3>
            <p className="text-xs text-n-500 mt-0.5">{t.subtitle}</p>
          </div>
        </div>
        {!loading && !error && data && (
          <AlertIndicator level={f09Alert} language={language} />
        )}
      </div>

      {/* Body */}
      {error ? (
        <div className="flex items-start gap-2 rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-5/6" />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* F01-F10 table */}
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm border-collapse" aria-label={t.tableLabel}>
              <thead>
                <tr className="border-b border-n-200/40">
                  <th className="text-left py-1.5 pr-3 text-xs uppercase tracking-eyebrow text-n-500 font-medium w-6">#</th>
                  <th className="text-left py-1.5 pr-3 text-xs uppercase tracking-eyebrow text-n-500 font-medium">{t.colConcepto}</th>
                  <th className="text-right py-1.5 pr-3 text-xs uppercase tracking-eyebrow text-n-500 font-medium tabular-nums">{t.colValor}</th>
                  <th className="text-left py-1.5 text-xs uppercase tracking-eyebrow text-n-500 font-medium hidden sm:table-cell">{t.colNorma}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.key}
                    className={cn(
                      'border-b border-n-200/20',
                      'hover:bg-n-50 transition-colors',
                      row.bold && 'font-semibold',
                    )}
                  >
                    <td className="py-1.5 pr-3 text-xs text-n-500 tabular-nums">{`F${String(idx + 1).padStart(2, '0')}`}</td>
                    <td className={cn('py-1.5 pr-3', row.bold ? 'text-n-1000' : 'text-n-800')}>
                      {row.label}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 pr-3 text-right tabular-nums',
                        row.key === 'f09' ? f09Color(data.data.f09Pct) : 'text-n-1000',
                        row.bold && 'font-semibold',
                      )}
                    >
                      {row.value}
                    </td>
                    <td className="py-1.5 hidden sm:table-cell">
                      <NormaCitation norma={row.norma} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Alerta tasa mínima */}
          {data.data.alertaTasaMinima && (
            <div
              className={cn(
                'rounded-md p-3 text-xs leading-relaxed',
                'bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.3)]',
              )}
              role="alert"
              aria-live="polite"
            >
              <span className="font-semibold text-danger">{t.alertaTasaMinima} </span>
              <span className="text-n-700">
                {language === 'es'
                  ? 'TTD no determinable: faltan impuesto depurado, utilidad depurada y verificación de aplicabilidad. F09 no determina el impuesto adicional.'
                  : 'TTD unavailable: adjusted tax, adjusted profit and applicability must be verified. F09 does not determine additional tax.'}
              </span>
            </div>
          )}

          {data.data.eficienciaFiscal == null && (
            <p className="text-xs text-n-700">{language === 'es' ? 'Eficiencia no determinable: falta base referencial positiva o cobertura válida.' : 'Efficiency unavailable: a positive reference base and valid coverage are required.'}</p>
          )}
          {/* Eficiencia fiscal badge */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-n-500">{t.eficiencia}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-label',
                data.data.eficienciaFiscal == null
                  ? 'bg-n-100 text-n-800'
                  : data.data.eficienciaFiscal === 'alta'
                  ? 'bg-[rgb(34_197_94_/_0.12)] text-success ring-1 ring-[rgb(34_197_94_/_0.3)]'
                  : data.data.eficienciaFiscal === 'media'
                  ? 'bg-[rgb(234_179_8_/_0.14)] text-warning ring-1 ring-[rgb(234_179_8_/_0.35)]'
                  : 'bg-[rgb(239_68_68_/_0.14)] text-danger ring-1 ring-[rgb(239_68_68_/_0.4)]',
              )}
            >
              {EficienciaIcon && <EficienciaIcon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
              {data.data.eficienciaFiscal == null ? 'N/D' : language === 'es'
                ? data.data.eficienciaFiscal === 'alta' ? 'Alta' : data.data.eficienciaFiscal === 'media' ? 'Media' : 'Baja'
                : data.data.eficienciaFiscal === 'alta' ? 'High' : data.data.eficienciaFiscal === 'media' ? 'Medium' : 'Low'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40">
          <NormaCitation norma="Art. 240 E.T." />
        </div>
      )}
    </article>
  );
}
