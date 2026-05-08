'use client';

/**
 * QuickStartPeriodButton — botón un-clic que abre el periodo actual.
 *
 * Variants:
 *  - 'inline': botón compacto para usar dentro de toolbars u acciones secundarias
 *  - 'card':   panel grande con icono, copy explicativa y CTA — pensado para
 *              empty states donde el bloqueo de asientos por falta de periodo
 *              activo aparece y queremos resolverlo en un solo gesto.
 *
 * Si el server retorna 422/409 (overlap), interpretamos como "el periodo ya
 * existe" y disparamos el callback igual con un mensaje informativo — el
 * usuario ya tiene un periodo abierto, así que el flujo de asientos puede
 * proceder.
 */

import { useState } from 'react';
import { CalendarPlus, Loader2, Sparkles } from 'lucide-react';
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

export interface QuickStartPeriodButtonProps {
  year: number;
  month: number;
  variant?: 'inline' | 'card';
  label?: string;
  onPeriodOpened?: (period: AccountingPeriod | null) => void;
  className?: string;
}

export function QuickStartPeriodButton({
  year,
  month,
  variant = 'inline',
  label,
  onPeriodOpened,
  className,
}: QuickStartPeriodButtonProps) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const isEs = language === 'es';
  const months = isEs ? MONTHS_ES : MONTHS_EN;
  const monthLabel = months[Math.max(0, Math.min(11, month - 1))];

  const defaultLabel =
    label ??
    (isEs
      ? `Abrir periodo actual (${monthLabel} ${year}) ahora`
      : `Open current period (${monthLabel} ${year}) now`);

  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | { ok: true; period: AccountingPeriod }
        | { error: string };
      if (res.status === 201 && 'period' in json) {
        toast(
          'success',
          isEs
            ? `Periodo ${monthLabel} ${year} abierto`
            : `Period ${monthLabel} ${year} opened`,
        );
        onPeriodOpened?.(json.period);
        return;
      }
      // Idempotente: si el server dice "ya existe", consideramos OK para el flujo.
      if (res.status === 409 || res.status === 422) {
        toast(
          'info',
          isEs
            ? `${monthLabel} ${year} ya existe — listo para registrar.`
            : `${monthLabel} ${year} already exists — ready to register.`,
        );
        onPeriodOpened?.(null);
        return;
      }
      const err = 'error' in json ? json.error : 'unknown';
      toast('error', isEs ? `Error: ${err}` : `Error: ${err}`, 6000);
    } catch {
      toast('error', isEs ? 'Falla de red.' : 'Network failure.', 6000);
    } finally {
      setSubmitting(false);
    }
  }

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2',
          'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
          'text-sm font-semibold',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        data-testid="quick-start-inline"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {defaultLabel}
      </button>
    );
  }

  // variant === 'card'
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 rounded-2xl',
        'border border-gold-500/30 bg-n-0',
        'p-8 max-w-md w-full text-center',
        'shadow-e1',
        className,
      )}
      data-testid="quick-start-card"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-gold-500/10 text-gold-600"
      >
        <Sparkles className="h-6 w-6" />
      </span>
      <div>
        <h3 className="font-serif-elite text-xl text-n-1000">
          {isEs ? 'Aún no hay periodos contables' : 'No accounting periods yet'}
        </h3>
        <p className="mt-1.5 text-sm text-n-700">
          {isEs
            ? 'Para registrar asientos necesitas un periodo activo. Abre el del mes actual con un solo clic.'
            : 'To register journal entries you need an active period. Open the current month with one click.'}
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-5 py-2.5',
          'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
          'text-sm font-semibold shadow-glow-gold-soft',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {defaultLabel}
      </button>
    </div>
  );
}

export default QuickStartPeriodButton;
