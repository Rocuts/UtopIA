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

/** Formatea valor COP abreviado para la lista. Ej: $1.200M / $450K */
function formatCopShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${Math.round(abs / 1_000_000).toLocaleString('es-CO')}M`;
  return `$${Math.round(abs).toLocaleString('es-CO')}`;
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
          <label className="text-xs text-n-400 uppercase tracking-wide font-mono" htmlFor="capex-name">
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
              'bg-n-900/60 border border-n-700 text-n-100 placeholder:text-n-600',
              'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
              'transition-colors duration-150',
            )}
          />
        </div>

        {/* Mes + Monto (fila) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-n-400 uppercase tracking-wide font-mono" htmlFor="capex-month">
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
                'bg-n-900/60 border border-n-700 text-n-100 placeholder:text-n-600',
                'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
                'transition-colors duration-150',
              )}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-n-400 uppercase tracking-wide font-mono" htmlFor="capex-amount">
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
                'bg-n-900/60 border border-n-700 text-n-100 placeholder:text-n-600',
                'focus:outline-none focus:ring-1 focus:ring-gold-500/60 focus:border-gold-500/60',
                'transition-colors duration-150',
              )}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400" role="alert">
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
            'text-gold-300 hover:text-gold-200',
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
            <span className="text-xs text-n-500 uppercase tracking-wide font-mono">
              {isEs
                ? `${events.length} evento${events.length !== 1 ? 's' : ''} · Total ${formatCopShort(totalCop)}`
                : `${events.length} event${events.length !== 1 ? 's' : ''} · Total ${formatCopShort(totalCop)}`}
            </span>
          </div>

          {events.map((ev) => (
            <div
              key={ev.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg px-3 py-2',
                'bg-n-900/40 border border-n-700/50',
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-n-100 truncate">{ev.name}</p>
                <p className="text-xs text-n-500">
                  {isEs ? `Mes ${ev.monthOffset}` : `Month ${ev.monthOffset}`}
                  {' · '}
                  <span className="text-gold-400">{formatCopShort(ev.amountCop)}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(ev.id)}
                aria-label={isEs ? `Eliminar ${ev.name}` : `Remove ${ev.name}`}
                className={cn(
                  'shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md',
                  'text-n-500 hover:text-red-400',
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
