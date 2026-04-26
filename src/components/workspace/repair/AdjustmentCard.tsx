'use client';

// ---------------------------------------------------------------------------
// AdjustmentCard — visual de un ajuste propuesto / aplicado / rechazado en el
// Doctor de Datos (Phase 2).
//
// Estados:
//   - proposed  → border-warning, bg amber suave, botones Aplicar/Rechazar
//   - applied   → border-success, bg success suave, timestamp aplicado
//   - rejected  → border n-300, bg n-50, opacity 0.6 (atenuado)
//
// El componente NO ejecuta side-effects: solo invoca `onConfirm` / `onReject`
// que el host (RepairChat) cablea contra el hook.
// ---------------------------------------------------------------------------

import { memo, useCallback, useState } from 'react';
import { CheckCircle2, XCircle, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Adjustment, RepairLanguage } from '@/lib/agents/repair/types';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface AdjustmentCardProps {
  adjustment: Adjustment;
  /** Si el adjustment está 'proposed' y se proveen estos callbacks, se
   *  renderizan los botones inline. */
  onConfirm?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Cuando el chat está cargando, los botones se deshabilitan. */
  disabled?: boolean;
  language: RepairLanguage;
}

// ─── i18n ───────────────────────────────────────────────────────────────────

const COPY = {
  es: {
    statusProposed: 'Propuesto',
    statusApplied: 'Aplicado',
    statusRejected: 'Rechazado',
    accountLabel: 'Cuenta',
    amountLabel: 'Monto',
    rationaleLabel: 'Razón',
    confirm: 'Aplicar',
    reject: 'Rechazar',
    expand: 'Ver más',
    collapse: 'Ver menos',
    appliedAt: 'Aplicado',
    rejectedAt: 'Rechazado',
    secondsAgo: (n: number) => `hace ${n} segundo${n === 1 ? '' : 's'}`,
    minutesAgo: (n: number) => `hace ${n} minuto${n === 1 ? '' : 's'}`,
    hoursAgo: (n: number) => `hace ${n} hora${n === 1 ? '' : 's'}`,
    justNow: 'hace un instante',
    ariaLabel: (status: string, code: string, formattedAmount: string) =>
      `Ajuste ${status} en cuenta ${code} por ${formattedAmount}`,
  },
  en: {
    statusProposed: 'Proposed',
    statusApplied: 'Applied',
    statusRejected: 'Rejected',
    accountLabel: 'Account',
    amountLabel: 'Amount',
    rationaleLabel: 'Reason',
    confirm: 'Apply',
    reject: 'Reject',
    expand: 'Show more',
    collapse: 'Show less',
    appliedAt: 'Applied',
    rejectedAt: 'Rejected',
    secondsAgo: (n: number) => `${n} second${n === 1 ? '' : 's'} ago`,
    minutesAgo: (n: number) => `${n} minute${n === 1 ? '' : 's'} ago`,
    hoursAgo: (n: number) => `${n} hour${n === 1 ? '' : 's'} ago`,
    justNow: 'just now',
    ariaLabel: (status: string, code: string, formattedAmount: string) =>
      `${status} adjustment on account ${code} for ${formattedAmount}`,
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

const RATIONALE_TRUNCATE = 200;

/**
 * Formatea un monto signed en pesos colombianos: "+$1.234.567,89" / "-$1.234.567,89".
 * Usa Intl con `signDisplay: 'always'`. Si el monto es 0 muestra "$0".
 */
function formatSignedPeso(amount: number, language: RepairLanguage): string {
  if (!Number.isFinite(amount) || amount === 0) {
    return language === 'en' ? '$0' : '$0';
  }
  const locale = language === 'en' ? 'en-US' : 'es-CO';
  // Intl.NumberFormat acepta signDisplay para forzar el "+".
  const fmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
    signDisplay: 'always',
  });
  // 'COP1.234' → reemplazamos a "$" para alinear con el resto del producto.
  return fmt.format(amount).replace(/COP\s?/i, '$').replace(/\s/g, '');
}

/** Formatea el timestamp ISO como "hace N s/m/h" o, si pasaron más, como fecha
 *  local corta. */
function formatRelativeTime(iso: string, language: RepairLanguage): string {
  const copy = COPY[language];
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return copy.justNow;
  if (diffSec < 60) return copy.secondsAgo(diffSec);
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return copy.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return copy.hoursAgo(diffHr);
  return new Date(iso).toLocaleString(language === 'en' ? 'en-US' : 'es-CO');
}

// ─── Componente ─────────────────────────────────────────────────────────────

function AdjustmentCardImpl({
  adjustment,
  onConfirm,
  onReject,
  disabled = false,
  language,
}: AdjustmentCardProps) {
  const copy = COPY[language];
  const [expanded, setExpanded] = useState(false);

  const { id, accountCode, accountName, amount, rationale, status } = adjustment;
  const shortId = id.slice(0, 6);
  const formattedAmount = formatSignedPeso(amount, language);

  const handleConfirm = useCallback(() => {
    if (disabled || !onConfirm) return;
    onConfirm(id);
  }, [disabled, onConfirm, id]);

  const handleReject = useCallback(() => {
    if (disabled || !onReject) return;
    onReject(id);
  }, [disabled, onReject, id]);

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  // Status visual config — derived state during render (no useEffect).
  const statusLabel =
    status === 'proposed'
      ? copy.statusProposed
      : status === 'applied'
        ? copy.statusApplied
        : copy.statusRejected;

  const statusIcon =
    status === 'proposed' ? (
      <Hourglass className="w-3.5 h-3.5" aria-hidden="true" />
    ) : status === 'applied' ? (
      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
    ) : (
      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
    );

  const isLongRationale = rationale.length > RATIONALE_TRUNCATE;
  const visibleRationale =
    expanded || !isLongRationale
      ? rationale
      : `${rationale.slice(0, RATIONALE_TRUNCATE)}…`;

  return (
    <article
      aria-label={copy.ariaLabel(statusLabel, accountCode, formattedAmount)}
      className={cn(
        'rounded-md border border-l-4 px-3 py-2.5 transition-colors',
        status === 'proposed' &&
          'border-n-200 border-l-warning bg-warning/8',
        status === 'applied' &&
          'border-n-200 border-l-success bg-success/8',
        status === 'rejected' &&
          'border-n-200 border-l-n-300 bg-n-50 opacity-60',
      )}
    >
      {/* Header: status + short id */}
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            'flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide',
            status === 'proposed' && 'text-warning',
            status === 'applied' && 'text-success',
            status === 'rejected' && 'text-n-600',
          )}
        >
          {statusIcon}
          <span>{statusLabel}</span>
        </div>
        <span
          className="font-mono text-2xs text-n-500"
          title={id}
          aria-label={`id ${shortId}`}
        >
          {shortId}
        </span>
      </div>

      {/* Body */}
      <div className="mt-2 space-y-1.5">
        <div className="text-xs text-n-700">
          <span className="text-n-500">{copy.accountLabel}:</span>{' '}
          <span className="font-mono text-n-900">{accountCode}</span>{' '}
          <span className="text-n-700">({accountName})</span>
        </div>
        <div className="text-sm">
          <span className="text-n-500 text-xs">{copy.amountLabel}:</span>{' '}
          <span
            className={cn(
              'font-mono font-semibold tabular-nums',
              amount > 0 && 'text-success',
              amount < 0 && 'text-danger',
              amount === 0 && 'text-n-700',
            )}
          >
            {formattedAmount}
          </span>
        </div>
        <div className="text-xs text-n-700">
          <span className="text-n-500">{copy.rationaleLabel}:</span>{' '}
          <span className="break-words">{visibleRationale}</span>
          {isLongRationale && (
            <button
              type="button"
              onClick={toggleExpand}
              className="ml-1 text-xs font-medium text-gold-500 hover:text-gold-600 transition-colors"
              aria-expanded={expanded}
            >
              {expanded ? copy.collapse : copy.expand}
            </button>
          )}
        </div>
      </div>

      {/* Footer actions / timestamp */}
      {status === 'proposed' && onConfirm && onReject && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={disabled}
            aria-label={`${copy.confirm} ${shortId}`}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium transition-colors',
              'bg-gold-500 text-n-0 hover:bg-gold-600',
              'disabled:bg-n-200 disabled:text-n-500 disabled:cursor-not-allowed',
            )}
          >
            {copy.confirm}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={disabled}
            aria-label={`${copy.reject} ${shortId}`}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium transition-colors',
              'text-n-700 hover:text-n-900 hover:bg-n-100',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {copy.reject}
          </button>
        </div>
      )}

      {status === 'applied' && adjustment.appliedAt && (
        <div className="mt-2 text-2xs text-n-500">
          {copy.appliedAt}: {formatRelativeTime(adjustment.appliedAt, language)}
        </div>
      )}
      {status === 'rejected' && adjustment.rejectedAt && (
        <div className="mt-2 text-2xs text-n-500">
          {copy.rejectedAt}: {formatRelativeTime(adjustment.rejectedAt, language)}
        </div>
      )}
    </article>
  );
}

// memo: el padre re-renderiza con frecuencia (cada token SSE). Como las props
// son primitivas + el objeto adjustment cambia por identity solo cuando muta,
// memo evita re-renders innecesarios de cards estables.
export const AdjustmentCard = memo(AdjustmentCardImpl);

export default AdjustmentCard;
