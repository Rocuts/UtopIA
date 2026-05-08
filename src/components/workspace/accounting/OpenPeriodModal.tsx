'use client';

/**
 * OpenPeriodModal — Crea un nuevo `accounting_period` con status='open'.
 *
 * El server (POST /api/accounting/periods) ya valida overlap mediante el
 * unique index `(workspaceId, year, month)`. Aquí hacemos pre-flight check
 * client-side para feedback inmediato si el usuario selecciona un mes que
 * ya existe en el mismo año (evita roundtrip).
 */

import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { GlassModal } from '@/components/ui/GlassModal';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/design-system/components/Toast';
import { cn } from '@/lib/utils';

import type { AccountingPeriod } from './PeriodsManagementView';

interface Props {
  open: boolean;
  onClose: () => void;
  existingPeriods: AccountingPeriod[];
  defaultYear: number;
  onPeriodOpened?: (period: AccountingPeriod) => void;
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function OpenPeriodModal({
  open,
  onClose,
  existingPeriods,
  defaultYear,
  onPeriodOpened,
}: Props) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const isEs = language === 'es';
  const months = isEs ? MONTHS_ES : MONTHS_EN;

  const now = new Date();
  const [year, setYear] = useState<number>(defaultYear);
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setYear(defaultYear);
      setMonth(now.getMonth() + 1);
      setSubmitting(false);
    }
  }, [open, defaultYear, now]);

  const yearOptions = useMemo(() => {
    const cy = now.getFullYear();
    const out: number[] = [];
    for (let y = cy - 2; y <= cy + 1; y += 1) out.push(y);
    return out;
  }, [now]);

  const overlap = useMemo(
    () => existingPeriods.some((p) => p.year === year && p.month === month),
    [existingPeriods, year, month],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (overlap) return;
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
            ? `Periodo ${months[month - 1]} ${year} creado`
            : `Period ${months[month - 1]} ${year} created`,
        );
        onPeriodOpened?.(json.period);
        return;
      }
      // Conflict (overlap on server side, e.g. race condition)
      if (res.status === 409 || res.status === 422) {
        toast(
          'error',
          isEs
            ? `Ya existe un periodo en ${months[month - 1]} ${year}`
            : `A period already exists for ${months[month - 1]} ${year}`,
          6000,
        );
        return;
      }
      const err = 'error' in json ? json.error : 'unknown_error';
      toast('error', isEs ? `Error: ${err}` : `Error: ${err}`, 6000);
    } catch {
      toast('error', isEs ? 'Falla de red.' : 'Network failure.', 6000);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={isEs ? 'Abrir nuevo periodo' : 'Open new period'}
      description={
        isEs
          ? 'Selecciona el mes y año del periodo contable a abrir. El sistema valida que no haya solapamiento.'
          : 'Select the month and year of the accounting period to open. The system validates non-overlap.'
      }
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'inline-flex items-center px-4 py-2 rounded-md',
              'border border-gold-500/30 text-n-100 hover:bg-gold-500/10 transition-colors',
              'text-sm',
            )}
          >
            {isEs ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            type="submit"
            form="open-period-form"
            disabled={submitting || overlap}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md',
              'bg-gold-500 text-n-1000 hover:bg-gold-600 transition-colors',
              'text-sm font-semibold',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            )}
            {isEs ? 'Crear periodo' : 'Create period'}
          </button>
        </>
      }
    >
      <form id="open-period-form" onSubmit={handleSubmit} className="flex flex-col gap-5 py-2">
        <div className="grid grid-cols-2 gap-4">
          <Field label={isEs ? 'Mes' : 'Month'}>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={submitting}
              className={selectClass}
              data-testid="month-select"
            >
              {months.map((m, i) => (
                <option key={m} value={i + 1}>{`${m} (${i + 1})`}</option>
              ))}
            </select>
          </Field>
          <Field label={isEs ? 'Año' : 'Year'}>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={submitting}
              className={selectClass}
              data-testid="year-select"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
        </div>
        {overlap && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {isEs
              ? `Ya existe un periodo en ${months[month - 1]} ${year}.`
              : `A period already exists for ${months[month - 1]} ${year}.`}
          </div>
        )}
      </form>
    </GlassModal>
  );
}

const selectClass = cn(
  'w-full rounded-md border border-gold-500/25 bg-n-1000/60 px-3 py-2',
  'text-sm text-n-100 font-mono',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
  'disabled:opacity-50',
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">{label}</span>
      {children}
    </label>
  );
}
