'use client';

/**
 * /workspace/contabilidad/asientos/nuevo — Nuevo Asiento Contable
 *
 * Self-contained client page for creating a new double-entry journal entry.
 * Validates that debits == credits before allowing "Contabilizar".
 */

import { useCallback, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  Loader2,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatCOP,
  parseCOPToNumber,
  sumCOPStrings,
  parseCOP,
} from '@/lib/format/cop';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntryLine {
  id: string;
  cuenta: string;
  descripcion: string;
  debito: string;
  credito: string;
}

type TipoAsiento = 'manual' | 'ajuste' | 'apertura';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newLine(): EntryLine {
  return {
    id:
      typeof window !== 'undefined' && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `l-${Math.random().toString(36).slice(2)}`,
    cuenta: '',
    descripcion: '',
    debito: '',
    credito: '',
  };
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const TIPO_LABELS: Record<TipoAsiento, string> = {
  manual: 'Manual',
  ajuste: 'Ajuste',
  apertura: 'Apertura',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function NuevoAsientoPage() {
  const router = useRouter();
  const formId = useId();

  // Header state
  const [fecha, setFecha] = useState<string>(nowIso());
  const [concepto, setConcepto] = useState<string>('');
  const [tipo, setTipo] = useState<TipoAsiento>('manual');

  // Lines state
  const [lines, setLines] = useState<EntryLine[]>(() => [newLine(), newLine()]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Totals ──────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const debitStr = sumCOPStrings(lines.map((l) => parseCOP(l.debito)));
    const creditStr = sumCOPStrings(lines.map((l) => parseCOP(l.credito)));
    const debitNum = parseCOPToNumber(debitStr);
    const creditNum = parseCOPToNumber(creditStr);
    const diff = Math.abs(debitNum - creditNum);
    const isBalanced = diff < 0.01; // centavo tolerance
    return { debit: debitStr, credit: creditStr, diff: diff.toFixed(2), isBalanced };
  }, [lines]);

  const canPost = totals.isBalanced && parseCOPToNumber(totals.debit) > 0;

  // ─── Line handlers ────────────────────────────────────────────────────────

  const updateLine = useCallback((id: string, patch: Partial<EntryLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, newLine()]);
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l.id !== id)));
  }, []);

  // Lock the opposite side when a value is typed — a line can't have both
  const handleDebitChange = useCallback((id: string, val: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, debito: val, credito: val.trim() === '' ? l.credito : '' }
          : l,
      ),
    );
  }, []);

  const handleCreditChange = useCallback((id: string, val: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, credito: val, debito: val.trim() === '' ? l.debito : '' }
          : l,
      ),
    );
  }, []);

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!canPost) return;
    if (!concepto.trim()) {
      setError('El concepto es obligatorio.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const payloadLines = lines
        .filter((l) => {
          const d = parseCOPToNumber(l.debito);
          const c = parseCOPToNumber(l.credito);
          return l.cuenta.trim() && (d > 0 || c > 0);
        })
        .map((l) => ({
          cuenta: l.cuenta.trim(),
          descripcion: l.descripcion.trim() || null,
          debito: parseCOP(l.debito),
          credito: parseCOP(l.credito),
        }));

      const res = await fetch('/api/accounting/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryDate: fecha,
          description: concepto.trim(),
          sourceType: tipo,
          status: 'posted',
          lines: payloadLines,
        }),
      });

      if (!res.ok) {
        let msg = 'Error al contabilizar el asiento.';
        try {
          const j = (await res.json()) as { error?: string; message?: string };
          msg = j.error ?? j.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      router.push('/workspace/contabilidad');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setSubmitting(false);
    }
  }, [canPost, concepto, fecha, tipo, lines, router]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const inputCls = cn(
    'w-full h-9 px-3 rounded-md border bg-n-0',
    'border-n-200 focus:border-[#B8934A]/60 outline-none',
    'text-sm text-n-1000 placeholder:text-n-500',
    'focus-visible:ring-2 focus-visible:ring-[#B8934A]/40',
    'transition-colors',
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10">
      {/* Back link */}
      <Link
        href="/workspace/contabilidad"
        className={cn(
          'inline-flex items-center gap-1.5 mb-6',
          'text-xs font-mono uppercase tracking-widest text-n-600',
          'hover:text-n-1000 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]/50 rounded',
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Page heading */}
      <header className="mb-8">
        <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#B8934A] font-medium mb-1">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          Contabilidad
        </p>
        <h1 className="text-2xl md:text-3xl font-semibold text-n-1000 tracking-tight">
          Nuevo Asiento Contable
        </h1>
        <p className="mt-1.5 text-sm text-n-700">
          Registre un asiento por partida doble. La diferencia debe ser cero para poder contabilizar.
        </p>
      </header>

      <form
        id={formId}
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-col gap-6"
      >
        {/* ── Section 1: Encabezado ─────────────────────────────────────── */}
        <section
          aria-label="Encabezado del asiento"
          className="rounded-xl border border-[#B8934A]/20 bg-n-0 p-5"
        >
          <h2 className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-4">
            Encabezado
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Fecha */}
            <div>
              <label
                htmlFor={`${formId}-fecha`}
                className="block text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-1.5"
              >
                Fecha
              </label>
              <input
                id={`${formId}-fecha`}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={cn(inputCls, 'tabular-nums')}
              />
            </div>

            {/* Concepto */}
            <div>
              <label
                htmlFor={`${formId}-concepto`}
                className="block text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-1.5"
              >
                Concepto
              </label>
              <input
                id={`${formId}-concepto`}
                type="text"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Ej. Venta de mercancía de contado"
                className={inputCls}
              />
            </div>

            {/* Tipo */}
            <div>
              <label
                htmlFor={`${formId}-tipo`}
                className="block text-xs font-mono uppercase tracking-widest text-n-600 font-semibold mb-1.5"
              >
                Tipo
              </label>
              <select
                id={`${formId}-tipo`}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoAsiento)}
                className={inputCls}
              >
                {(Object.entries(TIPO_LABELS) as [TipoAsiento, string][]).map(
                  ([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
        </section>

        {/* ── Section 2: Movimientos ────────────────────────────────────── */}
        <section
          aria-label="Líneas del asiento"
          className="rounded-xl border border-[#B8934A]/20 bg-n-0 overflow-hidden"
        >
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-n-600 font-semibold">
              Movimientos
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-n-50 border-y border-[#B8934A]/10">
                <tr>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-xs font-mono uppercase tracking-widest text-n-600 font-semibold w-[30%]"
                  >
                    Cuenta
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-xs font-mono uppercase tracking-widest text-n-600 font-semibold w-[25%]"
                  >
                    Descripción
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right text-xs font-mono uppercase tracking-widest text-n-600 font-semibold w-[18%]"
                  >
                    Débito
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right text-xs font-mono uppercase tracking-widest text-n-600 font-semibold w-[18%]"
                  >
                    Crédito
                  </th>
                  <th scope="col" className="w-[9%]" aria-hidden="true" />
                </tr>
              </thead>

              <tbody>
                {lines.map((ln, idx) => (
                  <tr
                    key={ln.id}
                    className={cn(
                      'border-b last:border-b-0 border-n-100',
                      'even:bg-n-50/60 hover:bg-[#B8934A]/5 transition-colors',
                    )}
                  >
                    {/* Cuenta */}
                    <td className="px-2 py-2 align-middle">
                      <input
                        type="text"
                        value={ln.cuenta}
                        onChange={(e) => updateLine(ln.id, { cuenta: e.target.value })}
                        placeholder="Ej. 1105 · Caja"
                        aria-label={`Cuenta línea ${idx + 1}`}
                        className={cn(
                          'w-full h-8 px-2 rounded border bg-n-0 text-xs',
                          'border-n-200 focus:border-[#B8934A]/50 outline-none',
                          'text-n-1000 placeholder:text-n-400',
                          'focus-visible:ring-2 focus-visible:ring-[#B8934A]/30',
                        )}
                      />
                    </td>

                    {/* Descripción */}
                    <td className="px-2 py-2 align-middle">
                      <input
                        type="text"
                        value={ln.descripcion}
                        onChange={(e) => updateLine(ln.id, { descripcion: e.target.value })}
                        placeholder="—"
                        aria-label={`Descripción línea ${idx + 1}`}
                        className={cn(
                          'w-full h-8 px-2 rounded border bg-n-0 text-xs',
                          'border-n-200 focus:border-[#B8934A]/50 outline-none',
                          'text-n-1000 placeholder:text-n-400',
                          'focus-visible:ring-2 focus-visible:ring-[#B8934A]/30',
                        )}
                      />
                    </td>

                    {/* Débito */}
                    <td className="px-2 py-2 align-middle text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ln.debito}
                        onChange={(e) => handleDebitChange(ln.id, e.target.value)}
                        placeholder="0,00"
                        aria-label={`Débito línea ${idx + 1}`}
                        className={cn(
                          'w-full h-8 px-2 rounded border bg-n-0 text-xs text-right',
                          'border-n-200 focus:border-[#B8934A]/50 outline-none',
                          'text-n-1000 placeholder:text-n-400 tabular-nums',
                          'focus-visible:ring-2 focus-visible:ring-[#B8934A]/30',
                        )}
                      />
                    </td>

                    {/* Crédito */}
                    <td className="px-2 py-2 align-middle text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={ln.credito}
                        onChange={(e) => handleCreditChange(ln.id, e.target.value)}
                        placeholder="0,00"
                        aria-label={`Crédito línea ${idx + 1}`}
                        className={cn(
                          'w-full h-8 px-2 rounded border bg-n-0 text-xs text-right',
                          'border-n-200 focus:border-[#B8934A]/50 outline-none',
                          'text-n-1000 placeholder:text-n-400 tabular-nums',
                          'focus-visible:ring-2 focus-visible:ring-[#B8934A]/30',
                        )}
                      />
                    </td>

                    {/* Delete */}
                    <td className="px-1 py-2 align-middle text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(ln.id)}
                        disabled={lines.length <= 2}
                        aria-label={`Eliminar línea ${idx + 1}`}
                        className={cn(
                          'p-1.5 rounded text-n-500 hover:text-red-500 hover:bg-red-50',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
                          'disabled:opacity-30 disabled:cursor-not-allowed',
                          'disabled:hover:bg-transparent disabled:hover:text-n-500',
                          'transition-colors',
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals footer */}
              <tfoot className="bg-n-50 border-t-2 border-[#B8934A]/20">
                <tr>
                  <td colSpan={2} className="px-3 py-3">
                    <button
                      type="button"
                      onClick={addLine}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-1 rounded',
                        'text-xs font-medium text-[#B8934A] hover:bg-[#B8934A]/10',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]/50',
                        'transition-colors',
                      )}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Agregar línea
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="block text-2xs font-mono uppercase tracking-widest text-n-600 mb-0.5">
                      Total
                    </span>
                    <span className="font-mono font-semibold text-sm text-n-1000 tabular-nums">
                      {formatCOP(totals.debit)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="block text-2xs font-mono uppercase tracking-widest text-n-600 mb-0.5">
                      Total
                    </span>
                    <span className="font-mono font-semibold text-sm text-n-1000 tabular-nums">
                      {formatCOP(totals.credit)}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Balance badge */}
          <div className="px-5 pb-5 pt-2">
            <div role="status" aria-live="polite">
              {parseCOPToNumber(totals.debit) === 0 &&
              parseCOPToNumber(totals.credit) === 0 ? (
                <p className="text-xs font-mono text-n-500">
                  Ingrese al menos dos líneas con débito o crédito.
                </p>
              ) : totals.isBalanced ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md',
                    'bg-green-50 border border-green-200 text-green-700 font-semibold text-sm',
                  )}
                >
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Asiento cuadrado — diferencia $0
                </span>
              ) : (
                <span
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md',
                    'bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-sm',
                  )}
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Diferencia: {formatCOP(totals.diff)}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ── Error alert ──────────────────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            className={cn(
              'rounded-md border border-red-200 bg-red-50 px-4 py-3',
              'text-sm text-red-700 flex items-center gap-2',
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Action buttons ───────────────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end">
          <Link
            href="/workspace/contabilidad"
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md',
              'border border-n-200 text-n-800 bg-n-0 text-sm font-medium',
              'hover:bg-n-50 hover:text-n-1000 transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]/50',
            )}
          >
            Cancelar
          </Link>
          <button
            type="button"
            onClick={handlePost}
            disabled={submitting || !canPost}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-md',
              'bg-[#B8934A] text-white text-sm font-semibold',
              'hover:bg-[#a07d3e] active:bg-[#8c6d35] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8934A]',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#B8934A]',
              'shadow-sm',
            )}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            Contabilizar
          </button>
        </div>
      </form>
    </div>
  );
}
