'use client';

// ---------------------------------------------------------------------------
// ValidationStatusStrip — strip de validación pegado debajo del transcript del
// Doctor de Datos. Muestra el resultado del último `recheck_validation`:
//
//   - status === null → no renderiza nada (caller decide).
//   - status.ok       → strip verde + mini-tabla de totales.
//   - !status.ok      → strip rojo suave + lista de errors + mini-tabla.
//
// La mini-tabla muestra activo, pasivo, patrimonio, ingresos, gastos,
// utilidad neta y el diff de ecuación contable (ya formateado).
// ---------------------------------------------------------------------------

import { memo } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  RecheckValidationOutput,
  RepairLanguage,
} from '@/lib/agents/repair/types';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ValidationStatusStripProps {
  status: RecheckValidationOutput | null;
  language: RepairLanguage;
}

// ─── i18n ───────────────────────────────────────────────────────────────────

const COPY = {
  es: {
    okTitle: 'Validación pasada — ecuación cuadrada',
    failTitle: 'Validación falla',
    rowActivo: 'Activo',
    rowPasivo: 'Pasivo',
    rowPatrimonio: 'Patrimonio',
    rowEcuacionDiff: 'Diferencia ecuación',
    rowAppliedCount: 'Ajustes aplicados',
    pctSuffix: '%',
  },
  en: {
    okTitle: 'Validation passed — equation balances',
    failTitle: 'Validation failed',
    rowActivo: 'Assets',
    rowPasivo: 'Liabilities',
    rowPatrimonio: 'Equity',
    rowEcuacionDiff: 'Equation diff',
    rowAppliedCount: 'Adjustments applied',
    pctSuffix: '%',
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPeso(amount: number, language: RepairLanguage): string {
  if (!Number.isFinite(amount)) return '—';
  const locale = language === 'en' ? 'en-US' : 'es-CO';
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
  return fmt.format(amount).replace(/COP\s?/i, '$').replace(/\s/g, '');
}

function formatPct(pct: number, language: RepairLanguage): string {
  if (!Number.isFinite(pct)) return '—';
  const locale = language === 'en' ? 'en-US' : 'es-CO';
  return `${pct.toLocaleString(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}${COPY[language].pctSuffix}`;
}

// ─── Componente ─────────────────────────────────────────────────────────────

function ValidationStatusStripImpl({
  status,
  language,
}: ValidationStatusStripProps) {
  if (!status) return null;

  const copy = COPY[language];
  const ok = status.ok === true;
  const totals = status.controlTotals;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-5 my-3 rounded-md border px-3 py-2.5 transition-colors',
        ok
          ? 'border-success/40 bg-success/8'
          : 'border-danger/40 bg-danger/10',
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        {ok ? (
          <CheckCircle2
            className="w-4 h-4 mt-0.5 shrink-0 text-success"
            aria-hidden="true"
          />
        ) : (
          <AlertCircle
            className="w-4 h-4 mt-0.5 shrink-0 text-danger"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-xs font-semibold',
              ok ? 'text-success' : 'text-danger',
            )}
          >
            {ok ? copy.okTitle : copy.failTitle}
          </div>
          {/* Diff inline (siempre visible) */}
          <div className="mt-0.5 text-2xs text-n-700">
            <span className="text-n-500">{copy.rowEcuacionDiff}:</span>{' '}
            <span className="font-mono tabular-nums">
              {formatPeso(totals.ecuacionDiff, language)} (
              {formatPct(totals.ecuacionPct, language)})
            </span>
          </div>

          {/* Errors compactos cuando NO ok */}
          {!ok && status.errors && status.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-2xs text-danger">
              {status.errors.slice(0, 5).map((err, i) => (
                <li key={i} className="flex gap-1">
                  <span aria-hidden="true">·</span>
                  <span className="break-words">{err}</span>
                </li>
              ))}
              {status.errors.length > 5 && (
                <li className="text-n-500">
                  +{status.errors.length - 5}…
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Mini-tabla de totales */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        <Row
          label={copy.rowActivo}
          value={formatPeso(totals.activo, language)}
        />
        <Row
          label={copy.rowPasivo}
          value={formatPeso(totals.pasivo, language)}
        />
        <Row
          label={copy.rowPatrimonio}
          value={formatPeso(totals.patrimonio, language)}
        />
        <Row
          label={copy.rowAppliedCount}
          value={String(status.appliedAdjustmentsCount ?? 0)}
          mono={false}
        />
      </div>
    </div>
  );
}

// Subcomponente local — fila key/value de la mini-tabla.
function Row({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-n-500 truncate">{label}</span>
      <span
        className={cn(
          'text-n-900 tabular-nums truncate',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export const ValidationStatusStrip = memo(ValidationStatusStripImpl);

export default ValidationStatusStrip;
