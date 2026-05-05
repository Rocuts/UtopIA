'use client';

/**
 * PromoteEntries — botón + diálogo para promover pyme_entries confirmados
 * al Libro Mayor (journal_entries en estado 'draft').
 *
 * WS2: OCR → Journal Entry Bridge.
 * Feature flag: UTOPIA_ENABLE_OCR_PROMOTE=true (UI no renderiza si el flag
 * está OFF — el servidor retorna 503 de todas formas como barrera adicional).
 *
 * Props:
 *   - selectedEntries: las filas seleccionadas en el Ledger (o EntryReview).
 *   - onSuccess: callback tras promoción exitosa (para refrescar el Ledger).
 *   - taxEngineAvailable: si true, muestra el toggle del motor de impuestos.
 */

import { useCallback, useState } from 'react';
import {
  ArrowUpFromLine,
  CheckCircle,
  ChevronRight,
  Info,
  Loader2,
  X,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Tipos compartidos con el backend (sin importar de @/lib/* server-only)
// ---------------------------------------------------------------------------

export interface PromotableEntry {
  id: string;
  description: string;
  kind: 'ingreso' | 'egreso';
  amount: string;
  category: string | null;
  pucHint: string | null;
}

interface SkippedEntry {
  pymeEntryId: string;
  reason: string;
}

interface PromoteApiResult {
  ok: boolean;
  promotedCount?: number;
  journalEntryIds?: string[];
  skipped?: SkippedEntry[];
  warnings?: string[];
  error?: string;
  message?: string;
}

export interface PromoteEntriesProps {
  selectedEntries: PromotableEntry[];
  periodId: string;
  onSuccess?: (journalEntryIds: string[]) => void;
  taxEngineAvailable?: boolean;
  /** Clase CSS adicional para el botón disparador. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(amount: string, currency = 'COP'): string {
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return amount;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return amount;
  }
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PromoteEntries({
  selectedEntries,
  periodId,
  onSuccess,
  taxEngineAvailable = false,
  className,
}: PromoteEntriesProps) {
  const { t, language } = useLanguage();
  const tt = t.pyme.promote;

  const [open, setOpen] = useState(false);
  const [applyTax, setApplyTax] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<PromoteApiResult | null>(null);

  const count = selectedEntries.length;

  const handleOpen = useCallback(() => {
    if (count === 0) return;
    setStatus('idle');
    setResult(null);
    setOpen(true);
  }, [count]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setStatus('idle');
    setResult(null);
  }, []);

  const handlePromote = useCallback(async () => {
    if (!periodId.trim()) {
      setResult({ ok: false, error: 'no_period', message: tt.error_no_period });
      setStatus('error');
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch('/api/pyme/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pymeEntryIds: selectedEntries.map((e) => e.id),
          periodId,
          applyTaxEngine: applyTax,
        }),
      });

      const json = (await res.json()) as PromoteApiResult;

      if (!res.ok || !json.ok) {
        setResult(json);
        setStatus('error');
        return;
      }

      setResult(json);
      setStatus('success');
      if (json.journalEntryIds && json.journalEntryIds.length > 0) {
        onSuccess?.(json.journalEntryIds);
      }
    } catch (err) {
      setResult({
        ok: false,
        error: 'network_error',
        message: err instanceof Error ? err.message : tt.error_generic,
      });
      setStatus('error');
    }
  }, [selectedEntries, periodId, applyTax, tt, onSuccess]);

  // No render si no hay entries seleccionados.
  if (count === 0) return null;

  return (
    <>
      {/* Botón disparador */}
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
          'bg-area-escudo text-white hover:bg-area-escudo/90',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo/50',
          'disabled:opacity-50',
          className,
        )}
      >
        <ArrowUpFromLine className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {interpolate(tt.button_n, { n: count })}
      </button>

      {/* Modal backdrop */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="promote-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-n-1000/60 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className={cn(
              'relative z-10 w-full max-w-2xl rounded-2xl shadow-2xl',
              'bg-n-0 border border-n-200',
              'flex flex-col max-h-[90vh]',
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-n-200">
              <div>
                <h2
                  id="promote-dialog-title"
                  className="font-serif-elite text-lg font-medium text-n-1000"
                >
                  {tt.dialog_title}
                </h2>
                <p className="text-sm text-n-600 mt-0.5">{tt.dialog_subtitle}</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-n-500 hover:text-n-1000 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
                aria-label={tt.cancel}
              >
                <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div
              data-lenis-prevent
              className="flex-1 overflow-y-auto px-6 py-4 space-y-4 styled-scrollbar"
            >
              {/* Tabla de mapping */}
              {status !== 'success' && (
                <div className="overflow-x-auto rounded-xl border border-n-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-eyebrow text-n-600 bg-n-50">
                        <th className="px-3 py-2 font-medium">{tt.col_original}</th>
                        <th className="px-3 py-2 font-medium">{tt.col_kind}</th>
                        <th className="px-3 py-2 font-medium text-right">{tt.col_amount}</th>
                        <th className="px-3 py-2 font-medium">{tt.col_proposed}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEntries.map((e) => (
                        <tr
                          key={e.id}
                          className="border-t border-n-200 hover:bg-n-50 transition-colors"
                        >
                          <td className="px-3 py-2 text-n-1000 max-w-[200px] truncate">
                            {e.description}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                'text-xs font-medium',
                                e.kind === 'ingreso' ? 'text-success' : 'text-area-escudo',
                              )}
                            >
                              {e.kind === 'ingreso'
                                ? t.pyme.review.ingreso
                                : t.pyme.review.egreso}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right num whitespace-nowrap text-n-1000">
                            {formatAmount(e.amount)}
                          </td>
                          <td className="px-3 py-2 text-n-600 text-xs">
                            {e.pucHint ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="font-mono">{e.pucHint}</span>
                                <span className="text-n-400">·</span>
                                <span className="text-n-500">{e.category ?? '—'}</span>
                              </span>
                            ) : (
                              <span className="text-n-400">{tt.no_account}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Toggle tax engine */}
              {taxEngineAvailable && status !== 'success' && (
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <div className="mt-0.5">
                    <input
                      type="checkbox"
                      checked={applyTax}
                      onChange={(e) => setApplyTax(e.target.checked)}
                      className="h-4 w-4 rounded border-n-300 text-area-escudo focus:ring-area-escudo/30"
                    />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-n-1000">{tt.tax_engine_toggle}</span>
                    <p className="text-xs text-n-600 mt-0.5">{tt.tax_engine_hint}</p>
                  </div>
                </label>
              )}

              {/* Estado success */}
              {status === 'success' && result && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-success/10 border border-success/20">
                    <CheckCircle className="h-5 w-5 text-success shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-n-1000">{tt.success_title}</p>
                      <p className="text-xs text-n-600 mt-0.5">
                        {interpolate(tt.success_body, { n: result.promotedCount ?? 0 })}
                      </p>
                    </div>
                  </div>

                  {/* Skipped */}
                  {(result.skipped?.length ?? 0) > 0 && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-n-100 border border-n-200">
                      <Info className="h-4 w-4 text-n-500 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-n-800">{tt.skipped_title}</p>
                        <p className="text-xs text-n-600 mt-0.5">
                          {interpolate(tt.skipped_hint, { n: result.skipped!.length })}
                        </p>
                        <ul className="mt-2 space-y-0.5">
                          {result.skipped!.map((s) => (
                            <li key={s.pymeEntryId} className="text-xs text-n-500 font-mono">
                              {s.pymeEntryId.slice(0, 8)}… — {s.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Link a asientos */}
                  {(result.journalEntryIds?.length ?? 0) > 0 && (
                    <a
                      href="/workspace/contabilidad/asientos"
                      className="inline-flex items-center gap-2 text-sm font-medium text-area-escudo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded-sm"
                    >
                      {tt.view_entries}
                      <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  )}
                </div>
              )}

              {/* Estado error */}
              {status === 'error' && result && (
                <div className="p-4 rounded-xl bg-area-escudo/10 border border-area-escudo/20">
                  <p className="text-sm font-medium text-area-escudo">
                    {result.message ?? tt.error_generic}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-n-200">
              <button
                type="button"
                onClick={handleClose}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  'bg-n-100 text-n-1000 hover:bg-n-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                )}
              >
                {status === 'success' ? (language === 'es' ? 'Cerrar' : 'Close') : tt.cancel}
              </button>

              {status !== 'success' && (
                <button
                  type="button"
                  onClick={handlePromote}
                  disabled={status === 'loading'}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    'bg-area-escudo text-white hover:bg-area-escudo/90',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo/50',
                    'disabled:opacity-50',
                  )}
                >
                  {status === 'loading' && (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                  )}
                  {status === 'loading'
                    ? tt.promoting
                    : interpolate(tt.confirm, { n: count })}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
