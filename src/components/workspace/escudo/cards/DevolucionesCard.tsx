'use client';

/**
 * DevolucionesCard — Módulo 6: Devoluciones de Saldos a Favor.
 *
 * Saldo a favor (hero number) + viabilidad + checklist documentos +
 * alerta prescripción si saldo > 18 meses sin solicitar (Art. 854).
 */

import { PiggyBank, AlertCircle, CheckSquare } from 'lucide-react';
import { NormaCitation, AlertIndicator } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { DevolucionesModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import type { FiscalDevolucionesT } from '../types';

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30', className)}
    />
  );
}

const VIABILIDAD_CONFIG = {
  alta: { alert: 'verde' as const, label: { es: 'Alta viabilidad', en: 'High viability' } },
  media: { alert: 'amarillo' as const, label: { es: 'Viabilidad media', en: 'Medium viability' } },
  baja: { alert: 'rojo' as const, label: { es: 'Baja viabilidad', en: 'Low viability' } },
  no_aplica: { alert: 'verde' as const, label: { es: 'No aplica', en: 'N/A' } },
};

interface DevolucionesCardProps {
  data?: DevolucionesModuleResult;
  loading?: boolean;
  error?: string;
  t: FiscalDevolucionesT;
  language?: 'es' | 'en';
}

export function DevolucionesCard({ data, loading, error, t, language = 'es' }: DevolucionesCardProps) {
  const viabilidad = data ? VIABILIDAD_CONFIG[data.data.viabilidad] : null;
  const saldoPositivo = data ? BigInt(data.data.saldoAFavor) > BigInt(0) : false;

  return (
    <article
      className={cn(
        'relative flex flex-col gap-5 p-6 rounded-xl h-full',
        'glass-elite-elevated ring-1',
        viabilidad?.alert === 'verde'
          ? 'ring-[rgb(34_197_94_/_0.25)]'
          : viabilidad?.alert === 'amarillo'
          ? 'ring-[rgb(234_179_8_/_0.28)]'
          : 'ring-[rgb(239_68_68_/_0.3)]',
      )}
      aria-labelledby="devoluciones-title"
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
            {loading ? <Shimmer className="h-5 w-5 rounded" /> : <PiggyBank className="h-5 w-5" strokeWidth={1.75} />}
          </span>
          <h3 id="devoluciones-title" className="font-serif-elite text-lg leading-tight font-medium tracking-tight text-n-1000 truncate">
            {t.title}
          </h3>
        </div>
        {!loading && !error && viabilidad && (
          <AlertIndicator level={viabilidad.alert} language={language} />
        )}
      </div>

      {/* Body */}
      {error ? (
        <div className="rounded-md p-3 bg-[rgb(239_68_68_/_0.10)] ring-1 ring-[rgb(239_68_68_/_0.25)]" role="alert">
          <p className="text-sm text-danger leading-relaxed">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Shimmer className="h-14 w-40" />
          <Shimmer className="h-4 w-full" />
          <Shimmer className="h-4 w-5/6" />
          <Shimmer className="h-4 w-3/4" />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          {/* Hero: saldo a favor */}
          <div>
            <span className="block text-xs uppercase tracking-eyebrow text-n-500 mb-1">
              {t.saldoLabel}
            </span>
            <span
              className={cn(
                'font-serif-elite font-bold num leading-[1] text-4xl md:text-5xl',
                saldoPositivo ? 'text-success' : 'text-n-1000',
              )}
            >
              {fmtCop(data.data.saldoAFavor)}
            </span>
            {saldoPositivo && (
              <span className="ml-2 text-xs text-success">{language === 'es' ? '← a su favor' : '← in your favor'}</span>
            )}
          </div>

          {/* Viabilidad + plazos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-md bg-n-50/50 ring-1 ring-n-200/40">
              <span className="block text-xs text-n-500 mb-0.5">{language === 'es' ? 'Plazo DIAN' : 'DIAN deadline'}</span>
              <span className="font-medium text-n-1000">{data.data.plazoDian}</span>
            </div>
            <div className="p-3 rounded-md bg-n-50/50 ring-1 ring-n-200/40">
              <span className="block text-xs text-n-500 mb-0.5">{language === 'es' ? 'Con garantía' : 'With guarantee'}</span>
              <span className="font-medium text-n-1000">{data.data.plazoConGarantia}</span>
            </div>
          </div>

          {/* Documentos requeridos */}
          {data.data.documentosRequeridos.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-1.5">{t.documentosLabel}</p>
              <ul role="list" className="flex flex-col gap-1">
                {data.data.documentosRequeridos.map((doc, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-n-700">
                    <CheckSquare className="h-3 w-3 text-success shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
                    {doc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Alerta prescripción */}
          {data.data.riesgosIdentificados.length > 0 && (
            <div
              className="flex items-start gap-2 rounded-md p-3 bg-[rgb(234_179_8_/_0.10)] ring-1 ring-[rgb(234_179_8_/_0.25)]"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                {data.data.riesgosIdentificados.slice(0, 2).map((r, i) => (
                  <p key={i} className="text-xs text-n-800">{r}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Footer */}
      {!loading && !error && (
        <div className="mt-auto pt-2 border-t border-n-200/40">
          <NormaCitation norma="Arts. 850 / 854 / 815 E.T." />
        </div>
      )}
    </article>
  );
}
