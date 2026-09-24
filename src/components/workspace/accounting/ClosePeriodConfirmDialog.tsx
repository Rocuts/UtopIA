'use client';

/**
 * ClosePeriodConfirmDialog — confirma el cierre de un periodo.
 *
 * Auditoría 2026-09 (contab-nomina-04):
 *   - Períodos 1-12 → `POST /api/accounting/periods/close`: marca el período
 *     como cerrado y bloquea nuevos asientos. NO genera asiento de cierre ni
 *     traslada resultados a patrimonio (antes el texto lo prometía).
 *   - Período 13 (cierre anual, 31-dic) → `POST /api/accounting/close/start`:
 *     corre el workflow durable (health check, asiento de cierre contra
 *     360505 / 361005, bloqueo y hash). El período debe estar ABIERTO para que
 *     el workflow pueda contabilizar el asiento de cierre.
 */

import { useState } from 'react';
import { Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { GlassModal } from '@/components/ui/GlassModal';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/design-system/components/Toast';
import { cn } from '@/lib/utils';

import type { AccountingPeriod } from './PeriodsManagementView';
import { closeRequestFor, periodMonthLabel } from './period-close';

interface Props {
  period: AccountingPeriod | null;
  onClose: () => void;
  onClosed?: () => void;
}

export function ClosePeriodConfirmDialog({ period, onClose, onClosed }: Props) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const isEs = language === 'es';
  const pt = t.accounting.periods;

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!period) {
    return (
      <GlassModal open={false} onClose={onClose}>
        {null}
      </GlassModal>
    );
  }

  const request = closeRequestFor(period);
  const annual = request.kind === 'annual_workflow';
  const periodText = `${periodMonthLabel(period.month, isEs ? 'es' : 'en')} ${period.year}`;

  async function handleClose() {
    if (!period || !confirmed) return;
    setSubmitting(true);
    try {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        alreadyClosed?: boolean;
        status?: string;
        error?: unknown;
        message?: string;
      };
      if (res.ok) {
        if (annual) {
          toast(
            'success',
            res.status === 202
              ? pt.annualCloseStarted.replace('{year}', String(period.year))
              : pt.annualCloseAlreadyRunning,
            8000,
          );
        } else {
          toast(
            'success',
            json.alreadyClosed ? pt.alreadyClosed : pt.closed.replace('{period}', periodText),
          );
        }
        onClosed?.();
        return;
      }
      const code =
        typeof json.error === 'string'
          ? json.error
          : typeof json.message === 'string'
            ? json.message
            : 'close_failed';
      toast('error', `${pt.errorPrefix}: ${code.replace(/_/g, ' ')}`, 8000);
    } catch {
      toast('error', pt.networkError, 6000);
    } finally {
      setSubmitting(false);
      setConfirmed(false);
    }
  }

  function handleClose_() {
    if (submitting) return;
    setConfirmed(false);
    onClose();
  }

  return (
    <GlassModal
      open={!!period}
      onClose={handleClose_}
      title={annual ? pt.annualCloseTitle : pt.monthlyCloseTitle}
      description={
        annual
          ? pt.annualCloseDescription.replace('{year}', String(period.year))
          : pt.monthlyCloseDescription.replace('{period}', periodText)
      }
      size="lg"
      dismissOnBackdrop={!submitting}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose_}
            disabled={submitting}
            className={cn(
              'inline-flex items-center px-4 py-2 rounded-md',
              'border border-gold-500/30 text-n-800 hover:bg-gold-500/10 transition-colors',
              'text-sm disabled:opacity-50',
            )}
          >
            {pt.cancel}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={!confirmed || submitting}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md',
              'bg-danger text-n-0 hover:bg-danger/90 transition-colors',
              'text-sm font-semibold',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {pt.running}
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {annual ? pt.annualCloseRun : pt.closeRun}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-n-800 leading-relaxed">
            {annual ? pt.annualCloseBody : pt.monthlyCloseBody}
          </div>
        </div>

        <div className="rounded-md border border-gold-500/20 p-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label={pt.periodLabel} value={periodText} />
          <Stat label={pt.currentStatus} value={period.status} />
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={submitting}
            className="mt-1 h-4 w-4 rounded border-gold-500/40 bg-n-1000/60 text-gold-500 focus:ring-gold-500"
          />
          <span className="text-sm text-n-800">
            {annual ? pt.annualCloseConfirm : pt.monthlyCloseConfirm}
          </span>
        </label>
      </div>
    </GlassModal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">{label}</p>
      <p className="mt-0.5 text-n-1000 font-medium">{value}</p>
    </div>
  );
}
