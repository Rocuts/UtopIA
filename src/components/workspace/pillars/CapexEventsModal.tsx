'use client';

/**
 * CapexEventsModal — Modal para gestionar Eventos de Futuro (CapEx).
 *
 * Permite al usuario añadir gastos puntuales proyectados (compra de maquinaria,
 * pago de préstamo, dividendos, etc.) que se descuentan de la caja en el mes
 * correspondiente y se reflejan en FuturoTrendBars.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { GlassModal } from '@/components/ui/GlassModal';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { formatBigCop } from '@/lib/charts/format';
import type { CapexEvent } from '@/lib/pillars/futuro-bars';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formatea número en pesos colombianos con separadores de miles (es-CO). */
function formatCopDisplay(value: number): string {
  return value.toLocaleString('es-CO');
}

/** Convierte string con separadores de miles (ej. "1.200.000") a número. */
function parseCopInput(raw: string): number {
  const cleaned = raw.replace(/\./g, '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * COP abreviado para la lista (ratios-kpis-27): `$1,2 mil M` / `$450 mil` en
 * español — nunca `B`, que en español se lee como billón (10^12) — y
 * `$1.2B` / `$450K` en inglés. Los eventos son salidas: se muestra la magnitud.
 */
function formatCopShort(v: number, isEs: boolean): string {
  return formatBigCop(Math.abs(v), isEs ? 'es' : 'en');
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface CapexEventsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: CapexEvent[];
  onAdd: (event: Omit<CapexEvent, 'id'>) => void;
  onRemove: (id: string) => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Superficie y tinta de los campos (polaridad, CLAUDE.md; criterio del
 * utopia-contrast-auditor). Antes: `bg-n-900/60` + `text-n-100` +
 * `placeholder:text-n-600`, un campo de polaridad invertida dentro del vidrio
 * claro del modal: texto 4,3:1 en claro y placeholder fantasma (1,2:1 claro,
 * 1,1:1 oscuro). Ahora superficie de nivel `n-0`, tinta primaria `n-1000`
 * (18:1 / 16:1) y placeholder `n-500` (3,6:1 / 3,9:1).
 */
const INPUT_SURFACE = 'bg-n-0/60 border border-n-300 text-n-1000 placeholder:text-n-500';

export function CapexEventsModal({
  open,
  onOpenChange,
  events,
  onAdd,
  onRemove,
}: CapexEventsModalProps) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  const [name, setName] = useState('');
  const [monthStr, setMonthStr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName('');
    setMonthStr('');
    setAmountStr('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onOpenChange(false);
  }, [onOpenChange, resetForm]);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      const trimmedName = name.trim();
      const month = parseInt(monthStr, 10);
      const amount = parseCopInput(amountStr);

      if (!trimmedName) {
        setError(isEs ? 'El nombre es obligatorio.' : 'Name is required.');
        return;
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        setError(isEs ? 'El mes debe ser entre 1 y 12.' : 'Month must be between 1 and 12.');
        return;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        setError(isEs ? 'El monto debe ser un número positivo.' : 'Amount must be a positive number.');
        return;
      }

      onAdd({ name: trimmedName, monthOffset: month, amountCop: amount });
      resetForm();
    },
    [name, monthStr, amountStr, isEs, onAdd, resetForm],
  );

  const totalCop = events.reduce((s, e) => s + e.amountCop, 0);

  const title = isEs ? 'Eventos de Futuro' : 'Future Events';
  const description = isEs
    ? 'Gastos puntuales que se restan a la caja en el mes correspondiente.'
    : 'One-time expenses deducted from cash in the selected month.';

  return (
    <GlassModal
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      size="md"
    >
      {/* ── Formulario ─────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 mb-5">
        {/* Nombre */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-n-700 uppercase tracking-wide font-mono" htmlFor="capex-name">
            {isEs ? 'Nombre del evento' : 'Event name'}
          </label>
          <input
            id="capex-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isEs ? 'Ej. Compra Maquinaria' : 'e.g. Equipment Purchase'}
            maxLength={80}
            className={cn(
              'w-full rounded-lg px-3 py-2 text-sm',
              INPUT_SURFACE,
              'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
              'transition-colors duration-150',
            )}
          />
        </div>

        {/* Mes + Monto (fila) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-n-700 uppercase tracking-wide font-mono" htmlFor="capex-month">
              {isEs ? 'Mes (1-12)' : 'Month (1-12)'}
            </label>
            <input
              id="capex-month"
              type="number"
              min={1}
              max={12}
              step={1}
              value={monthStr}
              onChange={(e) => setMonthStr(e.target.value)}
              placeholder="1"
              className={cn(
                'w-full rounded-lg px-3 py-2 text-sm',
                INPUT_SURFACE,
                'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
                'transition-colors duration-150',
              )}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-n-700 uppercase tracking-wide font-mono" htmlFor="capex-amount">
              {isEs ? 'Monto COP' : 'Amount COP'}
            </label>
            <input
              id="capex-amount"
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="1.200.000"
              className={cn(
                'w-full rounded-lg px-3 py-2 text-sm',
                INPUT_SURFACE,
                'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
                'transition-colors duration-150',
              )}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        {/* Botón añadir */}
        <button
          type="submit"
          className={cn(
            'inline-flex items-center justify-center gap-2 self-start',
            'rounded-lg px-4 py-2 text-sm font-medium',
            'bg-gold-500/20 hover:bg-gold-500/30 border border-gold-500/40',
            // gold-300 como tinta era 1,1:1 (claro) / 1,5:1 (oscuro); el hover
            // a gold-200 (peldaño inexistente) no intensificaba.
            'text-gold-700 hover:text-n-1000',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60',
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {isEs ? 'Añadir evento' : 'Add event'}
        </button>
      </form>

      {/* ── Lista de eventos ────────────────────────────────────────────── */}
      {events.length === 0 ? (
        <p className="text-sm text-n-600 text-center py-4">
          {isEs ? 'Sin eventos programados.' : 'No scheduled events.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-n-600 uppercase tracking-wide font-mono">
              {isEs
                ? `${events.length} evento${events.length !== 1 ? 's' : ''} · Total ${formatCopShort(totalCop, isEs)}`
                : `${events.length} event${events.length !== 1 ? 's' : ''} · Total ${formatCopShort(totalCop, isEs)}`}
            </span>
          </div>

          {events.map((ev) => (
            <div
              key={ev.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg px-3 py-2',
                // Fila de superficie (n-100), no la n-900 invertida: sobre ésta
                // el texto n-500 y el monto gold-400 caían a ~1,4:1.
                'bg-n-100/60 border border-n-200',
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-n-1000 truncate">{ev.name}</p>
                <p className="text-xs text-n-700">
                  {isEs ? `Mes ${ev.monthOffset}` : `Month ${ev.monthOffset}`}
                  {' · '}
                  <span className="text-gold-700">{formatCopShort(ev.amountCop, isEs)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(ev.id)}
                aria-label={isEs ? `Eliminar ${ev.name}` : `Remove ${ev.name}`}
                className={cn(
                  'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md',
                  'text-n-600 hover:text-danger',
                  'hover:bg-red-500/10',
                  'transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </GlassModal>
  );
}

export default CapexEventsModal;
