'use client';

/**
 * ClosePeriodConfirmDialog — confirma el cierre de un periodo y dispara
 * `POST /api/accounting/periods/close`. El server lanza el workflow durable
 * WS5 (health check + asientos de cierre + hash de integridad), que puede
 * tardar entre 5–30s — mostramos loading state explícito.
 */

import { useState } from 'react';
import { Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { GlassModal } from '@/components/ui/GlassModal';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/design-system/components/Toast';
import { cn } from '@/lib/utils';

import type { AccountingPeriod } from './PeriodsManagementView';

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Props {
  period: AccountingPeriod | null;
  onClose: () => void;
  onClosed?: () => void;
}

export function ClosePeriodConfirmDialog({ period, onClose, onClosed }: Props) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const isEs = language === 'es';
  const months = isEs ? MONTHS_ES : MONTHS_EN;

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!period) {
    return (
      <GlassModal open={false} onClose={onClose}>
        {null}
      </GlassModal>
    );
  }

  const monthLabel = months[Math.max(0, Math.min(11, period.month - 1))];

  async function handleClose() {
    if (!period || !confirmed) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting/periods/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodId: period.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: true;
        period?: AccountingPeriod;
        alreadyClosed?: boolean;
        error?: string;
      };
      if (res.ok) {
        toast(
          'success',
          json.alreadyClosed
            ? isEs ? 'El periodo ya estaba cerrado.' : 'Period was already closed.'
            : isEs ? `Periodo ${monthLabel} ${period.year} cerrado` : `Period ${monthLabel} ${period.year} closed`,
        );
        onClosed?.();
        return;
      }
      const code = json.error ?? 'close_failed';
      toast('error', isEs ? `Error: ${code.replace(/_/g, ' ')}` : `Error: ${code.replace(/_/g, ' ')}`, 6000);
    } catch {
      toast('error', isEs ? 'Falla de red.' : 'Network failure.', 6000);
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
      title={isEs ? 'Cerrar periodo contable' : 'Close accounting period'}
      description={
        isEs
          ? `Vas a cerrar ${monthLabel} ${period.year}. Esta acción ejecuta el workflow durable de cierre mensual.`
          : `You are about to close ${monthLabel} ${period.year}. This action triggers the durable monthly close workflow.`
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
            {isEs ? 'Cancelar' : 'Cancel'}
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
                {isEs ? 'Ejecutando workflow…' : 'Running workflow…'}
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {isEs ? 'Cerrar periodo' : 'Close period'}
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
            {isEs
              ? 'El cierre ejecuta health check (cuadratura, conciliación bancaria, drafts pendientes), genera asientos de cierre, calcula hash SHA-256 encadenado al periodo anterior y bloquea el registro de nuevos asientos. Es reversible vía Reabrir hasta que se Bloquee.'
              : 'Closing runs health check (balance, bank reconciliation, pending drafts), generates closing entries, computes SHA-256 hash chained to the previous period, and blocks new entries. Reversible via Reopen until Locked.'}
          </div>
        </div>

        <div className="rounded-md border border-gold-500/20 p-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label={isEs ? 'Periodo' : 'Period'} value={`${monthLabel} ${period.year}`} />
          <Stat label={isEs ? 'Estado actual' : 'Current status'} value={period.status} />
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
            {isEs
              ? 'Acepto que este cierre ejecutará un workflow durable y bloqueará nuevos asientos en el periodo.'
              : 'I accept this close will run a durable workflow and block new entries in the period.'}
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
